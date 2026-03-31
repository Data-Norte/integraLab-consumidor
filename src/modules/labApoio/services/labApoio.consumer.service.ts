import env, { withPublicBasePath } from '../../../config/env.js';
import { logEvent } from '../../../shared/logging/logger.js';
import { LabApoioApiClient, type LabApoioApiClientLike } from './labApoio.api-client.js';
import { LabApoioConsumerError, toErrorMessage } from './labApoio.consumer.errors.js';
import { getLabApoioQaRuntimeConfig, type LabApoioQaRuntimeConfigStore } from './labApoio.qa.runtime-config.js';
import { getLabApoioQaStorage, type CreateQaRunInput, type LabApoioQaStorage } from './labApoio.qa.storage.js';
import { buildSyntheticExamArtifacts } from './labApoio.result-generator.js';
import { type PendingExam, type PendingExamDetail, type QaHmlBatchData } from './labApoio.schemas.js';

export type ProcessPendingExamsParams = {
  tenantId: string;
  tenantName?: string | null;
  limit?: number;
  triggerEvent?: string;
  triggerEventId?: string;
  source?: 'WEBHOOK' | 'MANUAL';
  webhookContext?: CreateQaRunInput['webhook'];
};

export type ProcessPendingExamsResult = {
  runId: string;
  qaUrl: string;
  tenantId: string;
  tenantName: string | null;
  ambiente: string;
  vinculoId: string;
  triggerEvent: string;
  triggerEventId: string | null;
  batches: number;
  attempted: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  completionReason: 'SEM_PENDENCIAS' | 'LOTE_REPETIDO' | 'MAX_BATCHES_REACHED';
  results: Array<{
    qaItemId?: string;
    agendaExameId: number;
    agendaExameItemId: number;
    codexame: number;
    status: 'SUCESSO' | 'ERRO';
    duplicado?: boolean;
    erro?: string;
    resultPreview?: string | null;
  }>;
};

type ProcessPendingExamsDeps = {
  apiClient?: LabApoioApiClientLike;
  qaStorage?: Pick<LabApoioQaStorage, 'createRun' | 'finishRun' | 'recordItem'>;
  vinculoId?: string;
  authSecret?: string;
  fornecId?: number | null;
  sendInlinePdf?: boolean;
  batchSize?: number;
  processingDelayMs?: number;
  maxBatches?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runtimeConfig?: Pick<LabApoioQaRuntimeConfigStore, 'getResolvedSecrets'>;
};

type GenerateQaHmlAgendamentosParams = {
  tenantId?: string;
};

type GenerateQaHmlAgendamentosDeps = {
  apiClient?: LabApoioApiClientLike;
  vinculoId?: string;
  authSecret?: string;
  runtimeConfig?: Pick<LabApoioQaRuntimeConfigStore, 'getResolvedSecrets'>;
};

const defaultApiClient = new LabApoioApiClient({
  baseUrl: env.INTEGRALAB_API_BASE_URL,
  timeoutMs: env.API_REQUEST_TIMEOUT_MS,
});

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function buildIdempotencyKey(prefix: string, exam: PendingExam) {
  return `${prefix}-${exam.agendaExameId}-${exam.agendaExameItemId}`;
}

async function getExamDetailSafe(
  apiClient: LabApoioApiClientLike,
  token: string,
  tenantId: string,
  exam: PendingExam,
  cache: Map<number, PendingExamDetail | null>
) {
  if (cache.has(exam.agendaExameId)) {
    return cache.get(exam.agendaExameId) ?? null;
  }

  try {
    const detail = await apiClient.getPendingExamDetail({
      token,
      tenantId,
      agendaExameId: exam.agendaExameId,
    });
    cache.set(exam.agendaExameId, detail);
    return detail;
  } catch (error) {
    const message = toErrorMessage(error);
    cache.set(exam.agendaExameId, null);
    logEvent('warn', 'pending_exam_detail_unavailable', {
      tenantId,
      agendaExameId: exam.agendaExameId,
      agendaExameItemId: exam.agendaExameItemId,
      error: message,
    });
    return null;
  }
}

function buildExamDetailSnapshot(exam: PendingExam, detail: PendingExamDetail | null) {
  if (detail) {
    return detail;
  }

  return {
    agendaExameId: exam.agendaExameId,
    itens: [
      {
        agendaExameItemId: exam.agendaExameItemId,
        codexame: exam.codexame,
        descricaoExame: exam.descricaoExame,
        status: exam.status,
        dataAgenda: exam.dataAgenda,
        pacienteId: exam.pacienteId,
        medicoId: null,
      },
    ],
  };
}

export async function processPendingExams(
  params: ProcessPendingExamsParams,
  deps: ProcessPendingExamsDeps = {}
): Promise<ProcessPendingExamsResult> {
  const runtimeSecrets = (deps.runtimeConfig ?? getLabApoioQaRuntimeConfig()).getResolvedSecrets();
  const services = {
    apiClient: deps.apiClient ?? defaultApiClient,
    qaStorage: deps.qaStorage ?? getLabApoioQaStorage(),
    vinculoId: deps.vinculoId ?? env.LAB_APOIO_VINCULO_ID,
    authSecret: deps.authSecret ?? runtimeSecrets.authSecret,
    fornecId: deps.fornecId ?? env.LAB_APOIO_FORNEC_ID,
    sendInlinePdf: deps.sendInlinePdf ?? env.LAB_APOIO_SEND_INLINE_PDF,
    batchSize: deps.batchSize ?? env.PROCESSING_BATCH_SIZE,
    processingDelayMs: deps.processingDelayMs ?? env.PROCESSING_DELAY_MS,
    maxBatches: deps.maxBatches ?? env.PROCESSING_MAX_BATCHES,
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? sleep,
  };

  if (!params.tenantId) {
    throw new LabApoioConsumerError(400, 'VALIDATION_ERROR', 'TenantId nao informado para processar pendencias.');
  }
  if (!services.vinculoId || !services.authSecret) {
    throw new LabApoioConsumerError(
      500,
      'CONFIGURATION_ERROR',
      'Configure LAB_APOIO_VINCULO_ID e LAB_APOIO_AUTH_SECRET no .env ou na tela pública de QA para consumir a API.'
    );
  }

  const token = await services.apiClient.issueIntegrationToken({
    vinculoId: services.vinculoId,
    segredo: services.authSecret,
  });
  const operationEnv = token.operationEnv ?? token.ambiente;

  const run = services.qaStorage.createRun({
    tenantId: params.tenantId,
    tenantName: params.tenantName ?? null,
    vinculoId: services.vinculoId,
    source: params.source ?? 'MANUAL',
    triggerEvent: params.triggerEvent ?? 'MANUAL',
    triggerEventId: params.triggerEventId ?? null,
    webhook: params.webhookContext ?? null,
    createdAt: services.now().toISOString(),
  });

  logEvent('info', 'pending_processing_started', {
    tenantId: params.tenantId,
    tenantName: params.tenantName ?? null,
    vinculoId: services.vinculoId,
    triggerEvent: params.triggerEvent ?? 'MANUAL',
    triggerEventId: params.triggerEventId ?? null,
    runId: run.id,
  });

  const attemptedItems = new Set<number>();
  const detailCache = new Map<number, PendingExamDetail | null>();
  const results: ProcessPendingExamsResult['results'] = [];
  let batches = 0;
  let completionReason: ProcessPendingExamsResult['completionReason'] = 'SEM_PENDENCIAS';

  while (batches < services.maxBatches) {
    const batch = await services.apiClient.listPendingExams({
      token: token.token,
      tenantId: params.tenantId,
      page: 1,
      limit: params.limit ?? services.batchSize,
    });

    if (batch.rows.length === 0) {
      completionReason = 'SEM_PENDENCIAS';
      break;
    }

    const freshRows = batch.rows.filter(row => !attemptedItems.has(row.agendaExameItemId));
    if (freshRows.length === 0) {
      completionReason = 'LOTE_REPETIDO';
      break;
    }

    batches += 1;

    for (const exam of freshRows) {
      attemptedItems.add(exam.agendaExameItemId);

      if (services.processingDelayMs > 0) {
        await services.sleep(services.processingDelayMs);
      }

      const now = services.now();
      const detail = await getExamDetailSafe(
        services.apiClient,
        token.token,
        params.tenantId,
        exam,
        detailCache
      );
      const detailSnapshot = buildExamDetailSnapshot(exam, detail);
      const generated = buildSyntheticExamArtifacts({
        tenantId: params.tenantId,
        exam,
        examDetail: detail,
        now,
      });

      const payload = {
        agendaExameItemId: exam.agendaExameItemId,
        codexame: exam.codexame,
        idempotencyKey: buildIdempotencyKey('resultado', exam),
        resultado: generated.result,
        pdf: services.sendInlinePdf
          ? {
            idempotencyKey: buildIdempotencyKey('pdf', exam),
            nomeArquivo: generated.pdfFileName,
            pdfBase64: generated.pdfBase64,
            fornecId: services.fornecId ?? undefined,
          }
          : undefined,
      };

      try {
        const envio = await services.apiClient.sendResultado({
          token: token.token,
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          payload,
        });

        const qaItem = services.qaStorage.recordItem({
          runId: run.id,
          tenantId: params.tenantId,
          tenantName: params.tenantName ?? null,
          vinculoId: services.vinculoId,
          ambiente: operationEnv,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          descricaoExame: exam.descricaoExame,
          status: 'SUCESSO',
          duplicado: Boolean(envio.duplicado),
          resultPreview: generated.resultPreview,
          pendingExam: exam,
          examDetail: detailSnapshot,
          generatedResult: generated.result,
          sendPayload: payload,
          apiResponse: envio,
          pdfBuffer: generated.pdfBuffer,
          pdfFileName: generated.pdfFileName,
          receivedAt: now.toISOString(),
          processedAt: services.now().toISOString(),
        });

        results.push({
          qaItemId: qaItem.id,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          status: 'SUCESSO',
          duplicado: Boolean(envio.duplicado),
          resultPreview: generated.resultPreview,
        });

        logEvent('info', 'pending_exam_processed', {
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          duplicado: Boolean(envio.duplicado),
          runId: run.id,
          qaItemId: qaItem.id,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        const qaItem = services.qaStorage.recordItem({
          runId: run.id,
          tenantId: params.tenantId,
          tenantName: params.tenantName ?? null,
          vinculoId: services.vinculoId,
          ambiente: operationEnv,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          descricaoExame: exam.descricaoExame,
          status: 'ERRO',
          erro: message,
          resultPreview: generated.resultPreview,
          pendingExam: exam,
          examDetail: detailSnapshot,
          generatedResult: generated.result,
          sendPayload: payload,
          apiResponse: {
            success: false,
            message,
          },
          pdfBuffer: generated.pdfBuffer,
          pdfFileName: generated.pdfFileName,
          receivedAt: now.toISOString(),
          processedAt: services.now().toISOString(),
        });

        results.push({
          qaItemId: qaItem.id,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          status: 'ERRO',
          erro: message,
          resultPreview: generated.resultPreview,
        });

        logEvent('error', 'pending_exam_failed', {
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          error: message,
          runId: run.id,
          qaItemId: qaItem.id,
        });
      }
    }
  }

  if (batches >= services.maxBatches && completionReason === 'SEM_PENDENCIAS' && results.length > 0) {
    completionReason = 'MAX_BATCHES_REACHED';
  }

  const successCount = results.filter(result => result.status === 'SUCESSO').length;
  const errorCount = results.filter(result => result.status === 'ERRO').length;
  const duplicateCount = results.filter(result => result.duplicado).length;

  const summary: ProcessPendingExamsResult = {
    runId: run.id,
    qaUrl: `${withPublicBasePath('/qa')}?runId=${run.id}`,
    tenantId: params.tenantId,
    tenantName: params.tenantName ?? null,
    ambiente: operationEnv,
    vinculoId: token.vinculoId,
    triggerEvent: params.triggerEvent ?? 'MANUAL',
    triggerEventId: params.triggerEventId ?? null,
    batches,
    attempted: attemptedItems.size,
    successCount,
    errorCount,
    duplicateCount,
    completionReason,
    results,
  };

  services.qaStorage.finishRun({
    runId: run.id,
    ambiente: summary.ambiente,
    batches: summary.batches,
    attempted: summary.attempted,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    duplicateCount: summary.duplicateCount,
    completionReason: summary.completionReason,
    summary,
    finishedAt: services.now().toISOString(),
  });

  logEvent('info', 'pending_processing_finished', {
    tenantId: summary.tenantId,
    batches: summary.batches,
    attempted: summary.attempted,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    duplicateCount: summary.duplicateCount,
    completionReason: summary.completionReason,
    runId: summary.runId,
  });

  return summary;
}

export async function generateQaHmlAgendamentos(
  params: GenerateQaHmlAgendamentosParams = {},
  deps: GenerateQaHmlAgendamentosDeps = {}
): Promise<QaHmlBatchData> {
  const runtimeSecrets = (deps.runtimeConfig ?? getLabApoioQaRuntimeConfig()).getResolvedSecrets();
  const services = {
    apiClient: deps.apiClient ?? defaultApiClient,
    vinculoId: deps.vinculoId ?? env.LAB_APOIO_VINCULO_ID,
    authSecret: deps.authSecret ?? runtimeSecrets.authSecret,
  };

  if (!services.vinculoId || !services.authSecret) {
    throw new LabApoioConsumerError(
      500,
      'CONFIGURATION_ERROR',
      'Configure LAB_APOIO_VINCULO_ID e LAB_APOIO_AUTH_SECRET no .env ou na tela pública de QA para consumir a API.'
    );
  }

  const token = await services.apiClient.issueIntegrationToken({
    vinculoId: services.vinculoId,
    segredo: services.authSecret,
    ambienteOperacao: 'hml',
  });
  const operationEnv = token.operationEnv ?? token.ambiente;

  if (operationEnv !== 'hml') {
    throw new LabApoioConsumerError(
      409,
      'UPSTREAM_ERROR',
      'O vinculo de QA nao esta operando em homologacao. Ajuste o ambiente para HML antes de gerar agendamentos de teste.'
    );
  }
  if (!services.apiClient.generateQaHmlBatch) {
    throw new LabApoioConsumerError(
      500,
      'CONFIGURATION_ERROR',
      'Cliente da API sem suporte para gerar agendamentos QA em homologacao.'
    );
  }

  const result = await services.apiClient.generateQaHmlBatch({
    token: token.token,
    tenantId: token.tenantId,
  });

  logEvent('info', 'qa_hml_batch_generated', {
    tenantId: params.tenantId ?? result.tenantId,
    vinculoId: result.vinculoId,
    generatedCount: result.generatedCount,
    cleanedAgendaExameIds: result.cleanedAgendaExameIds,
  });

  return result;
}
