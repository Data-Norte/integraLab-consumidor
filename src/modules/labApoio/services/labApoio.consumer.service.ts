import env from '../../../config/env.js';
import { logEvent } from '../../../shared/logging/logger.js';
import { LabApoioApiClient, type LabApoioApiClientLike } from './labApoio.api-client.js';
import { LabApoioConsumerError, toErrorMessage } from './labApoio.consumer.errors.js';
import { type PendingExam } from './labApoio.schemas.js';

export type ProcessPendingExamsParams = {
  tenantId: string;
  limit?: number;
  triggerEvent?: string;
  triggerEventId?: string;
};

export type ProcessPendingExamsResult = {
  tenantId: string;
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
    agendaExameId: number;
    agendaExameItemId: number;
    codexame: number;
    status: 'SUCESSO' | 'ERRO';
    duplicado?: boolean;
    erro?: string;
  }>;
};

type ProcessPendingExamsDeps = {
  apiClient?: LabApoioApiClientLike;
  vinculoId?: string;
  authSecret?: string;
  fornecId?: number | null;
  sendInlinePdf?: boolean;
  batchSize?: number;
  processingDelayMs?: number;
  maxBatches?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const defaultApiClient = new LabApoioApiClient({
  baseUrl: env.INTEGRALAB_API_BASE_URL,
  timeoutMs: env.API_REQUEST_TIMEOUT_MS,
});
const inFlightAgendaExameItems = new Set<number>();

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function buildResultadoFake(exam: PendingExam, now: Date) {
  return {
    status: 'CONCLUIDO',
    observacao: `Resultado simulado para ${exam.descricaoExame || `exame ${exam.codexame}`}`,
    liberado: true,
    prejudicado: false,
    parametros: [
      {
        descricao: exam.descricaoExame || `Exame ${exam.codexame}`,
        valor: '13.5',
        unidade1: 'g/dL',
        liberado: true,
        prejudicado: false,
        resultadoPadrao: now.toISOString(),
      },
    ],
  };
}

function normalizePdfLine(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function buildMinimalPdf(lines: string[]) {
  const contentLines = [
    'BT',
    '/F1 12 Tf',
    '50 780 Td',
    '16 TL',
    ...lines.flatMap((line, index) => (
      index === 0
        ? [`(${normalizePdfLine(line)}) Tj`]
        : ['T*', `(${normalizePdfLine(line)}) Tj`]
    )),
    'ET',
  ];
  const stream = `${contentLines.join('\n')}\n`;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8').toString('base64');
}

function buildPdfBase64Fake(exam: PendingExam, now: Date) {
  return buildMinimalPdf([
    'RESULTADO DO EXAME',
    '==================',
    `AgendaExameId: ${exam.agendaExameId}`,
    `AgendaExameItemId: ${exam.agendaExameItemId}`,
    `CodExame: ${exam.codexame}`,
    `Descricao: ${exam.descricaoExame || `Exame ${exam.codexame}`}`,
    'Status: CONCLUIDO',
    `GeradoEm: ${now.toISOString()}`,
  ]);
}

function buildIdempotencyKey(prefix: string, exam: PendingExam) {
  return `${prefix}-${exam.agendaExameId}-${exam.agendaExameItemId}`;
}

export async function processPendingExams(
  params: ProcessPendingExamsParams,
  deps: ProcessPendingExamsDeps = {}
): Promise<ProcessPendingExamsResult> {
  const services = {
    apiClient: deps.apiClient ?? defaultApiClient,
    vinculoId: deps.vinculoId ?? env.LAB_APOIO_VINCULO_ID,
    authSecret: deps.authSecret ?? env.LAB_APOIO_AUTH_SECRET,
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
      'Configure LAB_APOIO_VINCULO_ID e LAB_APOIO_AUTH_SECRET para consumir a API.'
    );
  }

  const token = await services.apiClient.issueIntegrationToken({
    vinculoId: services.vinculoId,
    segredo: services.authSecret,
  });

  logEvent('info', 'pending_processing_started', {
    tenantId: params.tenantId,
    vinculoId: services.vinculoId,
    triggerEvent: params.triggerEvent ?? 'MANUAL',
    triggerEventId: params.triggerEventId ?? null,
  });

  const attemptedItems = new Set<number>();
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

      if (inFlightAgendaExameItems.has(exam.agendaExameItemId)) {
        logEvent('info', 'pending_exam_skipped_inflight', {
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
        });
        continue;
      }

      inFlightAgendaExameItems.add(exam.agendaExameItemId);

      try {
        if (services.processingDelayMs > 0) {
          await services.sleep(services.processingDelayMs);
        }

        const now = services.now();

        const pdfPayload = services.sendInlinePdf
          ? {
            idempotencyKey: buildIdempotencyKey('pdf', exam),
            nomeArquivo: `resultado-${exam.agendaExameId}-${exam.agendaExameItemId}.pdf`,
            pdfBase64: buildPdfBase64Fake(exam, now),
            fornecId: services.fornecId ?? undefined,
          }
          : undefined;

        const envio = await services.apiClient.sendResultado({
          token: token.token,
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          payload: {
            agendaExameItemId: exam.agendaExameItemId,
            codexame: exam.codexame,
            idempotencyKey: buildIdempotencyKey('resultado', exam),
            resultado: buildResultadoFake(exam, now),
            pdf: pdfPayload,
          },
        });

        results.push({
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          status: 'SUCESSO',
          duplicado: Boolean(envio.duplicado),
        });

        logEvent('info', 'pending_exam_processed', {
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          duplicado: Boolean(envio.duplicado),
        });
      } catch (error) {
        const message = toErrorMessage(error);

        results.push({
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          codexame: exam.codexame,
          status: 'ERRO',
          erro: message,
        });

        logEvent('error', 'pending_exam_failed', {
          tenantId: params.tenantId,
          agendaExameId: exam.agendaExameId,
          agendaExameItemId: exam.agendaExameItemId,
          error: message,
        });
      } finally {
        inFlightAgendaExameItems.delete(exam.agendaExameItemId);
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
    tenantId: params.tenantId,
    ambiente: token.ambiente,
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

  logEvent('info', 'pending_processing_finished', {
    tenantId: summary.tenantId,
    batches: summary.batches,
    attempted: summary.attempted,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    duplicateCount: summary.duplicateCount,
    completionReason: summary.completionReason,
  });

  return summary;
}
