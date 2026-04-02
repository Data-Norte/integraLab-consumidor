import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import env, { withPublicBasePath } from '../../../config/env.js';

type NullableJson = string | null;
type SqlNamedParameters = Record<string, string | number | null>;

type QaWebhookContext = {
  headers: Record<string, string>;
  payload: unknown;
  rawBody: string;
} | null;

export type QaRunSource = 'WEBHOOK' | 'MANUAL';

export type CreateQaRunInput = {
  tenantId: string;
  tenantName?: string | null;
  vinculoId?: string | null;
  source: QaRunSource;
  triggerEvent: string;
  triggerEventId?: string | null;
  webhook?: QaWebhookContext;
  createdAt?: string;
};

export type QaRunRecord = {
  id: string;
  tenantId: string;
  tenantName: string | null;
  vinculoId: string | null;
  source: QaRunSource;
  triggerEvent: string;
  triggerEventId: string | null;
  createdAt: string;
  runRelativeDir: string;
};

export type RecordQaItemInput = {
  runId: string;
  tenantId: string;
  tenantName?: string | null;
  vinculoId?: string | null;
  ambiente: string;
  agendaExameId: number;
  agendaExameItemId: number;
  codexame: number;
  descricaoExame?: string | null;
  status: 'SUCESSO' | 'ERRO';
  duplicado?: boolean;
  erro?: string | null;
  resultPreview?: string | null;
  pendingExam: unknown;
  examDetail: unknown;
  generatedResult: unknown;
  sendPayload: unknown;
  apiResponse: unknown;
  pdfBuffer?: Buffer | null;
  pdfFileName?: string | null;
  receivedAt?: string;
  processedAt?: string;
};

type QaFileKind = 'entrada' | 'saida' | 'resultado' | 'resposta' | 'pdf';

type QaItemRow = {
  id: string;
  run_id: string;
  tenant_id: string;
  tenant_name: string | null;
  vinculo_id: string | null;
  ambiente: string;
  agenda_exame_id: number;
  agenda_exame_item_id: number;
  codexame: number;
  descricao_exame: string | null;
  status: string;
  duplicado: number;
  erro: string | null;
  result_preview: string | null;
  pending_exam_json: NullableJson;
  exam_detail_json: NullableJson;
  generated_result_json: NullableJson;
  send_payload_json: NullableJson;
  api_response_json: NullableJson;
  received_at: string;
  processed_at: string;
  pdf_relative_path: string | null;
  input_text_relative_path: string | null;
  output_text_relative_path: string | null;
  result_json_relative_path: string | null;
  response_json_relative_path: string | null;
};

type QaRunRow = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  vinculo_id: string | null;
  ambiente: string | null;
  trigger_source: QaRunSource;
  trigger_event: string;
  trigger_event_id: string | null;
  webhook_headers_json: NullableJson;
  webhook_payload_json: NullableJson;
  webhook_raw_body: string | null;
  summary_json: NullableJson;
  batches: number;
  attempted: number;
  success_count: number;
  error_count: number;
  duplicate_count: number;
  completion_reason: string | null;
  created_at: string;
  finished_at: string | null;
  run_relative_dir: string;
  context_text_relative_path: string | null;
  webhook_text_relative_path: string | null;
  summary_text_relative_path: string | null;
};

export type QaOverviewFilters = {
  tenantId?: string;
  status?: 'SUCESSO' | 'ERRO';
  runId?: string;
  limit?: number;
};

export type QaStorageOverview = {
  summary: {
    totalItems: number;
    successCount: number;
    errorCount: number;
    duplicateCount: number;
    totalRuns: number;
    totalTenants: number;
  };
  tenants: Array<{
    tenantId: string;
    tenantName: string | null;
    totalItems: number;
    lastProcessedAt: string | null;
  }>;
  runs: Array<{
    id: string;
    tenantId: string;
    tenantName: string | null;
    vinculoId: string | null;
    source: QaRunSource;
    triggerEvent: string;
    triggerEventId: string | null;
    ambiente: string | null;
    batches: number;
    attempted: number;
    successCount: number;
    errorCount: number;
    duplicateCount: number;
    completionReason: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
  rows: Array<{
    id: string;
    runId: string;
    tenantId: string;
    tenantName: string | null;
    vinculoId: string | null;
    ambiente: string;
    agendaExameId: number;
    agendaExameItemId: number;
    codexame: number;
    descricaoExame: string | null;
    status: 'SUCESSO' | 'ERRO';
    duplicado: boolean;
    erro: string | null;
    resultPreview: string | null;
    receivedAt: string;
    processedAt: string;
    files: Record<QaFileKind, string | null>;
  }>;
};

export type QaItemDetail = {
  id: string;
  runId: string;
  tenantId: string;
  tenantName: string | null;
  vinculoId: string | null;
  ambiente: string;
  agendaExameId: number;
  agendaExameItemId: number;
  codexame: number;
  descricaoExame: string | null;
  status: 'SUCESSO' | 'ERRO';
  duplicado: boolean;
  erro: string | null;
  resultPreview: string | null;
  receivedAt: string;
  processedAt: string;
  pendingExam: unknown;
  examDetail: unknown;
  generatedResult: unknown;
  sendPayload: unknown;
  apiResponse: unknown;
  files: Record<QaFileKind, string | null>;
  run: {
    id: string;
    tenantId: string;
    tenantName: string | null;
    vinculoId: string | null;
    ambiente: string | null;
    source: QaRunSource;
    triggerEvent: string;
    triggerEventId: string | null;
    createdAt: string;
    finishedAt: string | null;
    webhookHeaders: unknown;
    webhookPayload: unknown;
    webhookRawBody: string | null;
    summary: unknown;
    files: {
      context: string | null;
      webhook: string | null;
      summary: string | null;
    };
  };
};

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

function ensureDirectory(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'na';
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({
      error: 'FAILED_TO_STRINGIFY',
    });
  }
}

function parseJson(value: NullableJson) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return JSON.stringify({
      error: 'FAILED_TO_STRINGIFY',
    }, null, 2);
  }
}

function toForwardSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

function resolveNowIso(value?: string) {
  return value ?? new Date().toISOString();
}

function buildStoredSendPayload(payload: unknown, pdfFileName: string | null, pdfBuffer: Buffer | null | undefined) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const cloned = JSON.parse(safeJsonStringify(payload)) as Record<string, unknown>;
  const pdf = cloned.pdf;
  if (pdf && typeof pdf === 'object') {
    const pdfObject = { ...(pdf as Record<string, unknown>) };
    if ('pdfBase64' in pdfObject) {
      pdfObject.pdfBase64 = `[omitted base64; bytes=${pdfBuffer?.byteLength ?? 0}]`;
    }
    if (pdfFileName) {
      pdfObject.generatedFileName = pdfFileName;
    }
    cloned.pdf = pdfObject;
  }

  return cloned;
}

export class LabApoioQaStorage {
  private readonly rootDir: string;
  private readonly tenantsDir: string;
  private readonly dbFilePath: string;
  private readonly db: DatabaseSync;

  constructor(rootDir = env.QA_STORAGE_DIR) {
    this.rootDir = path.resolve(rootDir);
    this.tenantsDir = path.join(this.rootDir, 'tenants');
    this.dbFilePath = path.join(this.rootDir, 'consumer-qa.sqlite');

    ensureDirectory(this.rootDir);
    ensureDirectory(this.tenantsDir);

    this.db = new DatabaseSync(this.dbFilePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        tenant_name TEXT,
        vinculo_id TEXT,
        ambiente TEXT,
        trigger_source TEXT NOT NULL,
        trigger_event TEXT NOT NULL,
        trigger_event_id TEXT,
        webhook_headers_json TEXT,
        webhook_payload_json TEXT,
        webhook_raw_body TEXT,
        summary_json TEXT,
        batches INTEGER NOT NULL DEFAULT 0,
        attempted INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        completion_reason TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        run_relative_dir TEXT NOT NULL,
        context_text_relative_path TEXT,
        webhook_text_relative_path TEXT,
        summary_text_relative_path TEXT
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        tenant_name TEXT,
        vinculo_id TEXT,
        ambiente TEXT NOT NULL,
        agenda_exame_id INTEGER NOT NULL,
        agenda_exame_item_id INTEGER NOT NULL,
        codexame INTEGER NOT NULL,
        descricao_exame TEXT,
        status TEXT NOT NULL,
        duplicado INTEGER NOT NULL DEFAULT 0,
        erro TEXT,
        result_preview TEXT,
        pending_exam_json TEXT,
        exam_detail_json TEXT,
        generated_result_json TEXT,
        send_payload_json TEXT,
        api_response_json TEXT,
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        pdf_relative_path TEXT,
        input_text_relative_path TEXT,
        output_text_relative_path TEXT,
        result_json_relative_path TEXT,
        response_json_relative_path TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_runs_tenant_created ON runs(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_items_tenant_processed ON items(tenant_id, processed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_items_run ON items(run_id);
    `);
  }

  createRun(input: CreateQaRunInput): QaRunRecord {
    const runId = randomUUID();
    const createdAt = resolveNowIso(input.createdAt);
    const tenantDirName = sanitizePathSegment(input.tenantId);
    const runRelativeDir = toForwardSlashes(path.join('tenants', tenantDirName, 'runs', runId));
    const runAbsoluteDir = path.join(this.rootDir, runRelativeDir);
    ensureDirectory(runAbsoluteDir);

    const contextTextRelativePath = toForwardSlashes(path.join(runRelativeDir, 'contexto-execucao.txt'));
    const contextTextAbsolutePath = path.join(this.rootDir, contextTextRelativePath);
    const contextText = [
      'IntegraLab consumidor - execucao QA',
      `RunId: ${runId}`,
      `CriadoEm: ${createdAt}`,
      `TenantId: ${input.tenantId}`,
      `TenantNome: ${input.tenantName ?? ''}`,
      `VinculoId: ${input.vinculoId ?? ''}`,
      `Origem: ${input.source}`,
      `Evento: ${input.triggerEvent}`,
      `EventId: ${input.triggerEventId ?? ''}`,
    ].join('\n');
    fs.writeFileSync(contextTextAbsolutePath, contextText, 'utf8');

    let webhookTextRelativePath: string | null = null;
    if (input.webhook) {
      webhookTextRelativePath = toForwardSlashes(path.join(runRelativeDir, 'webhook-recebido.txt'));
      const webhookTextAbsolutePath = path.join(this.rootDir, webhookTextRelativePath);
      const webhookText = [
        'IntegraLab consumidor - webhook recebido',
        `RunId: ${runId}`,
        `TenantId: ${input.tenantId}`,
        `Evento: ${input.triggerEvent}`,
        '',
        'Headers:',
        prettyJson(input.webhook.headers),
        '',
        'Payload:',
        prettyJson(input.webhook.payload),
        '',
        'RawBody:',
        input.webhook.rawBody,
      ].join('\n');
      fs.writeFileSync(webhookTextAbsolutePath, webhookText, 'utf8');
    }

    this.db.prepare(`
      INSERT INTO runs (
        id,
        tenant_id,
        tenant_name,
        vinculo_id,
        trigger_source,
        trigger_event,
        trigger_event_id,
        webhook_headers_json,
        webhook_payload_json,
        webhook_raw_body,
        created_at,
        run_relative_dir,
        context_text_relative_path,
        webhook_text_relative_path
      ) VALUES (
        :id,
        :tenant_id,
        :tenant_name,
        :vinculo_id,
        :trigger_source,
        :trigger_event,
        :trigger_event_id,
        :webhook_headers_json,
        :webhook_payload_json,
        :webhook_raw_body,
        :created_at,
        :run_relative_dir,
        :context_text_relative_path,
        :webhook_text_relative_path
      )
    `).run({
      id: runId,
      tenant_id: input.tenantId,
      tenant_name: input.tenantName ?? null,
      vinculo_id: input.vinculoId ?? null,
      trigger_source: input.source,
      trigger_event: input.triggerEvent,
      trigger_event_id: input.triggerEventId ?? null,
      webhook_headers_json: input.webhook ? safeJsonStringify(input.webhook.headers) : null,
      webhook_payload_json: input.webhook ? safeJsonStringify(input.webhook.payload) : null,
      webhook_raw_body: input.webhook?.rawBody ?? null,
      created_at: createdAt,
      run_relative_dir: runRelativeDir,
      context_text_relative_path: contextTextRelativePath,
      webhook_text_relative_path: webhookTextRelativePath,
    });

    return {
      id: runId,
      tenantId: input.tenantId,
      tenantName: input.tenantName ?? null,
      vinculoId: input.vinculoId ?? null,
      source: input.source,
      triggerEvent: input.triggerEvent,
      triggerEventId: input.triggerEventId ?? null,
      createdAt,
      runRelativeDir,
    };
  }

  finishRun(params: {
    runId: string;
    ambiente: string;
    batches: number;
    attempted: number;
    successCount: number;
    errorCount: number;
    duplicateCount: number;
    completionReason: string;
    summary: unknown;
    finishedAt?: string;
  }) {
    const finishedAt = resolveNowIso(params.finishedAt);
    const runRow = this.getRunRow(params.runId);
    if (!runRow) {
      throw new Error(`Run QA nao encontrado: ${params.runId}`);
    }

    const summaryTextRelativePath = toForwardSlashes(path.join(runRow.run_relative_dir, 'resumo-execucao.txt'));
    const summaryTextAbsolutePath = path.join(this.rootDir, summaryTextRelativePath);
    const summaryText = [
      'IntegraLab consumidor - resumo de execucao',
      `RunId: ${params.runId}`,
      `FinalizadoEm: ${finishedAt}`,
      `Ambiente: ${params.ambiente}`,
      `Batches: ${params.batches}`,
      `Attempted: ${params.attempted}`,
      `SuccessCount: ${params.successCount}`,
      `ErrorCount: ${params.errorCount}`,
      `DuplicateCount: ${params.duplicateCount}`,
      `CompletionReason: ${params.completionReason}`,
      '',
      prettyJson(params.summary),
    ].join('\n');
    fs.writeFileSync(summaryTextAbsolutePath, summaryText, 'utf8');

    this.db.prepare(`
      UPDATE runs
      SET
        ambiente = :ambiente,
        summary_json = :summary_json,
        batches = :batches,
        attempted = :attempted,
        success_count = :success_count,
        error_count = :error_count,
        duplicate_count = :duplicate_count,
        completion_reason = :completion_reason,
        finished_at = :finished_at,
        summary_text_relative_path = :summary_text_relative_path
      WHERE id = :id
    `).run({
      id: params.runId,
      ambiente: params.ambiente,
      summary_json: safeJsonStringify(params.summary),
      batches: params.batches,
      attempted: params.attempted,
      success_count: params.successCount,
      error_count: params.errorCount,
      duplicate_count: params.duplicateCount,
      completion_reason: params.completionReason,
      finished_at: finishedAt,
      summary_text_relative_path: summaryTextRelativePath,
    });
  }

  recordItem(input: RecordQaItemInput) {
    const runRow = this.getRunRow(input.runId);
    if (!runRow) {
      throw new Error(`Run QA nao encontrado: ${input.runId}`);
    }

    const itemId = randomUUID();
    const receivedAt = resolveNowIso(input.receivedAt);
    const processedAt = resolveNowIso(input.processedAt);
    const itemDirRelative = toForwardSlashes(path.join(
      runRow.run_relative_dir,
      'itens',
      `${sanitizePathSegment(String(input.agendaExameItemId))}-${sanitizePathSegment(String(input.codexame))}`
    ));
    const itemDirAbsolute = path.join(this.rootDir, itemDirRelative);
    ensureDirectory(itemDirAbsolute);

    const inputTextRelativePath = toForwardSlashes(path.join(itemDirRelative, 'entrada-api.txt'));
    const outputTextRelativePath = toForwardSlashes(path.join(itemDirRelative, 'saida-api.txt'));
    const resultJsonRelativePath = toForwardSlashes(path.join(itemDirRelative, 'resultado-gerado.json'));
    const responseJsonRelativePath = toForwardSlashes(path.join(itemDirRelative, 'resposta-api.json'));

    const pdfFileName = input.pdfFileName ?? `resultado-${input.agendaExameId}-${input.agendaExameItemId}.pdf`;
    const pdfRelativePath = input.pdfBuffer
      ? toForwardSlashes(path.join(itemDirRelative, sanitizePathSegment(pdfFileName)))
      : null;

    const storedSendPayload = buildStoredSendPayload(input.sendPayload, pdfFileName, input.pdfBuffer);

    fs.writeFileSync(
      path.join(this.rootDir, inputTextRelativePath),
      [
        'IntegraLab consumidor - dados recebidos da API',
        `RunId: ${input.runId}`,
        `TenantId: ${input.tenantId}`,
        `TenantNome: ${input.tenantName ?? ''}`,
        `VinculoId: ${input.vinculoId ?? ''}`,
        `AgendaExameId: ${input.agendaExameId}`,
        `AgendaExameItemId: ${input.agendaExameItemId}`,
        `CodExame: ${input.codexame}`,
        `DescricaoExame: ${input.descricaoExame ?? ''}`,
        `RecebidoEm: ${receivedAt}`,
        '',
        'Pendencia:',
        prettyJson(input.pendingExam),
        '',
        'Detalhe da API:',
        prettyJson(input.examDetail),
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(this.rootDir, outputTextRelativePath),
      [
        'IntegraLab consumidor - dados enviados para a API',
        `RunId: ${input.runId}`,
        `StatusLocal: ${input.status}`,
        `Duplicado: ${Boolean(input.duplicado)}`,
        `ProcessadoEm: ${processedAt}`,
        `Erro: ${input.erro ?? ''}`,
        '',
        'Resultado gerado:',
        prettyJson(input.generatedResult),
        '',
        'Payload enviado:',
        prettyJson(storedSendPayload),
        '',
        'Resposta da API:',
        prettyJson(input.apiResponse),
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(this.rootDir, resultJsonRelativePath),
      prettyJson(input.generatedResult),
      'utf8'
    );

    fs.writeFileSync(
      path.join(this.rootDir, responseJsonRelativePath),
      prettyJson(input.apiResponse),
      'utf8'
    );

    if (input.pdfBuffer && pdfRelativePath) {
      fs.writeFileSync(path.join(this.rootDir, pdfRelativePath), input.pdfBuffer);
    }

    this.db.prepare(`
      INSERT INTO items (
        id,
        run_id,
        tenant_id,
        tenant_name,
        vinculo_id,
        ambiente,
        agenda_exame_id,
        agenda_exame_item_id,
        codexame,
        descricao_exame,
        status,
        duplicado,
        erro,
        result_preview,
        pending_exam_json,
        exam_detail_json,
        generated_result_json,
        send_payload_json,
        api_response_json,
        received_at,
        processed_at,
        pdf_relative_path,
        input_text_relative_path,
        output_text_relative_path,
        result_json_relative_path,
        response_json_relative_path
      ) VALUES (
        :id,
        :run_id,
        :tenant_id,
        :tenant_name,
        :vinculo_id,
        :ambiente,
        :agenda_exame_id,
        :agenda_exame_item_id,
        :codexame,
        :descricao_exame,
        :status,
        :duplicado,
        :erro,
        :result_preview,
        :pending_exam_json,
        :exam_detail_json,
        :generated_result_json,
        :send_payload_json,
        :api_response_json,
        :received_at,
        :processed_at,
        :pdf_relative_path,
        :input_text_relative_path,
        :output_text_relative_path,
        :result_json_relative_path,
        :response_json_relative_path
      )
    `).run({
      id: itemId,
      run_id: input.runId,
      tenant_id: input.tenantId,
      tenant_name: input.tenantName ?? null,
      vinculo_id: input.vinculoId ?? null,
      ambiente: input.ambiente,
      agenda_exame_id: input.agendaExameId,
      agenda_exame_item_id: input.agendaExameItemId,
      codexame: input.codexame,
      descricao_exame: input.descricaoExame ?? null,
      status: input.status,
      duplicado: input.duplicado ? 1 : 0,
      erro: input.erro ?? null,
      result_preview: input.resultPreview ?? null,
      pending_exam_json: safeJsonStringify(input.pendingExam),
      exam_detail_json: safeJsonStringify(input.examDetail),
      generated_result_json: safeJsonStringify(input.generatedResult),
      send_payload_json: safeJsonStringify(storedSendPayload),
      api_response_json: safeJsonStringify(input.apiResponse),
      received_at: receivedAt,
      processed_at: processedAt,
      pdf_relative_path: pdfRelativePath,
      input_text_relative_path: inputTextRelativePath,
      output_text_relative_path: outputTextRelativePath,
      result_json_relative_path: resultJsonRelativePath,
      response_json_relative_path: responseJsonRelativePath,
    });

    return {
      id: itemId,
      files: this.buildFileUrls(itemId, {
        pdf_relative_path: pdfRelativePath,
        input_text_relative_path: inputTextRelativePath,
        output_text_relative_path: outputTextRelativePath,
        result_json_relative_path: resultJsonRelativePath,
        response_json_relative_path: responseJsonRelativePath,
      }),
    };
  }

  getOverview(filters: QaOverviewFilters = {}): QaStorageOverview {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const params: SqlNamedParameters = {};
    const itemWhere = this.buildItemWhereClause(filters, params);

    const summary = this.db.prepare(`
      SELECT
        COUNT(*) AS total_items,
        SUM(CASE WHEN status = 'SUCESSO' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'ERRO' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN duplicado = 1 THEN 1 ELSE 0 END) AS duplicate_count
      FROM items
      ${itemWhere.sql}
    `).get(params) as {
      total_items?: number;
      success_count?: number;
      error_count?: number;
      duplicate_count?: number;
    };

    const tenantWhereParts: string[] = [];
    const tenantParams: SqlNamedParameters = {};
    if (filters.tenantId) {
      tenantWhereParts.push('tenant_id = :tenant_id');
      tenantParams.tenant_id = filters.tenantId;
    }
    const tenantWhere = tenantWhereParts.length > 0 ? `WHERE ${tenantWhereParts.join(' AND ')}` : '';
    const tenants = this.db.prepare(`
      SELECT
        tenant_id,
        MAX(tenant_name) AS tenant_name,
        COUNT(*) AS total_items,
        MAX(processed_at) AS last_processed_at
      FROM items
      ${tenantWhere}
      GROUP BY tenant_id
      ORDER BY COALESCE(MAX(processed_at), '') DESC, tenant_id ASC
    `).all(tenantParams) as Array<{
      tenant_id: string;
      tenant_name: string | null;
      total_items: number;
      last_processed_at: string | null;
    }>;

    const runWhereParts: string[] = [];
    const runParams: SqlNamedParameters = {};
    if (filters.tenantId) {
      runWhereParts.push('tenant_id = :tenant_id');
      runParams.tenant_id = filters.tenantId;
    }
    if (filters.runId) {
      runWhereParts.push('id = :run_id');
      runParams.run_id = filters.runId;
    }
    const runWhere = runWhereParts.length > 0 ? `WHERE ${runWhereParts.join(' AND ')}` : '';
    const runs = this.db.prepare(`
      SELECT *
      FROM runs
      ${runWhere}
      ORDER BY created_at DESC
      LIMIT 20
    `).all(runParams) as QaRunRow[];

    const rows = this.db.prepare(`
      SELECT *
      FROM items
      ${itemWhere.sql}
      ORDER BY processed_at DESC
      LIMIT :limit
    `).all({
      ...params,
      limit,
    }) as QaItemRow[];

    return {
      summary: {
        totalItems: Number(summary.total_items ?? 0),
        successCount: Number(summary.success_count ?? 0),
        errorCount: Number(summary.error_count ?? 0),
        duplicateCount: Number(summary.duplicate_count ?? 0),
        totalRuns: runs.length,
        totalTenants: tenants.length,
      },
      tenants: tenants.map(tenant => ({
        tenantId: tenant.tenant_id,
        tenantName: tenant.tenant_name,
        totalItems: Number(tenant.total_items ?? 0),
        lastProcessedAt: tenant.last_processed_at,
      })),
      runs: runs.map(run => ({
        id: run.id,
        tenantId: run.tenant_id,
        tenantName: run.tenant_name,
        vinculoId: run.vinculo_id,
        source: run.trigger_source,
        triggerEvent: run.trigger_event,
        triggerEventId: run.trigger_event_id,
        ambiente: run.ambiente,
        batches: Number(run.batches ?? 0),
        attempted: Number(run.attempted ?? 0),
        successCount: Number(run.success_count ?? 0),
        errorCount: Number(run.error_count ?? 0),
        duplicateCount: Number(run.duplicate_count ?? 0),
        completionReason: run.completion_reason,
        createdAt: run.created_at,
        finishedAt: run.finished_at,
      })),
      rows: rows.map(row => ({
        id: row.id,
        runId: row.run_id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        vinculoId: row.vinculo_id,
        ambiente: row.ambiente,
        agendaExameId: row.agenda_exame_id,
        agendaExameItemId: row.agenda_exame_item_id,
        codexame: row.codexame,
        descricaoExame: row.descricao_exame,
        status: row.status as 'SUCESSO' | 'ERRO',
        duplicado: Boolean(row.duplicado),
        erro: row.erro,
        resultPreview: row.result_preview,
        receivedAt: row.received_at,
        processedAt: row.processed_at,
        files: this.buildFileUrls(row.id, row),
      })),
    };
  }

  getItemDetail(itemId: string): QaItemDetail | null {
    const item = this.db.prepare('SELECT * FROM items WHERE id = ? LIMIT 1').get(itemId) as QaItemRow | undefined;
    if (!item) {
      return null;
    }

    const run = this.getRunRow(item.run_id);
    if (!run) {
      throw new Error(`Run QA nao encontrado para o item ${itemId}`);
    }

    return {
      id: item.id,
      runId: item.run_id,
      tenantId: item.tenant_id,
      tenantName: item.tenant_name,
      vinculoId: item.vinculo_id,
      ambiente: item.ambiente,
      agendaExameId: item.agenda_exame_id,
      agendaExameItemId: item.agenda_exame_item_id,
      codexame: item.codexame,
      descricaoExame: item.descricao_exame,
      status: item.status as 'SUCESSO' | 'ERRO',
      duplicado: Boolean(item.duplicado),
      erro: item.erro,
      resultPreview: item.result_preview,
      receivedAt: item.received_at,
      processedAt: item.processed_at,
      pendingExam: parseJson(item.pending_exam_json),
      examDetail: parseJson(item.exam_detail_json),
      generatedResult: parseJson(item.generated_result_json),
      sendPayload: parseJson(item.send_payload_json),
      apiResponse: parseJson(item.api_response_json),
      files: this.buildFileUrls(item.id, item),
      run: {
        id: run.id,
        tenantId: run.tenant_id,
        tenantName: run.tenant_name,
        vinculoId: run.vinculo_id,
        ambiente: run.ambiente,
        source: run.trigger_source,
        triggerEvent: run.trigger_event,
        triggerEventId: run.trigger_event_id,
        createdAt: run.created_at,
        finishedAt: run.finished_at,
        webhookHeaders: parseJson(run.webhook_headers_json),
        webhookPayload: parseJson(run.webhook_payload_json),
        webhookRawBody: run.webhook_raw_body,
        summary: parseJson(run.summary_json),
        files: {
          context: run.context_text_relative_path
            ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/runs/${run.id}/arquivos/contexto`)
            : null,
          webhook: run.webhook_text_relative_path
            ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/runs/${run.id}/arquivos/webhook`)
            : null,
          summary: run.summary_text_relative_path
            ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/runs/${run.id}/arquivos/resumo`)
            : null,
        },
      },
    };
  }

  resolveItemFile(itemId: string, kind: QaFileKind) {
    const item = this.db.prepare('SELECT * FROM items WHERE id = ? LIMIT 1').get(itemId) as QaItemRow | undefined;
    if (!item) {
      return null;
    }

    const relativePath = this.getItemRelativePath(item, kind);
    if (!relativePath) {
      return null;
    }

    const absolutePath = path.resolve(this.rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    return {
      absolutePath,
      fileName: path.basename(absolutePath),
      contentType: this.resolveContentType(kind),
    };
  }

  resolveRunFile(runId: string, kind: 'contexto' | 'webhook' | 'resumo') {
    const run = this.getRunRow(runId);
    if (!run) {
      return null;
    }

    const relativePath = kind === 'contexto'
      ? run.context_text_relative_path
      : kind === 'webhook'
        ? run.webhook_text_relative_path
        : run.summary_text_relative_path;
    if (!relativePath) {
      return null;
    }

    const absolutePath = path.resolve(this.rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    return {
      absolutePath,
      fileName: path.basename(absolutePath),
      contentType: 'text/plain; charset=utf-8',
    };
  }

  clearAllStorage() {
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM runs) AS total_runs,
        (SELECT COUNT(*) FROM items) AS total_items
    `).get() as {
      total_runs?: number;
      total_items?: number;
    };

    this.db.exec('DELETE FROM items; DELETE FROM runs;');

    if (fs.existsSync(this.tenantsDir)) {
      fs.rmSync(this.tenantsDir, { recursive: true, force: true });
    }
    ensureDirectory(this.tenantsDir);

    return {
      removedRuns: Number(counts.total_runs ?? 0),
      removedItems: Number(counts.total_items ?? 0),
      storageRoot: this.rootDir,
    };
  }

  private getRunRow(runId: string) {
    return this.db.prepare('SELECT * FROM runs WHERE id = ? LIMIT 1').get(runId) as QaRunRow | undefined;
  }

  private buildItemWhereClause(filters: QaOverviewFilters, params: SqlNamedParameters) {
    const conditions: string[] = [];

    if (filters.tenantId) {
      conditions.push('tenant_id = :tenant_id');
      params.tenant_id = filters.tenantId;
    }
    if (filters.status) {
      conditions.push('status = :status');
      params.status = filters.status;
    }
    if (filters.runId) {
      conditions.push('run_id = :run_id');
      params.run_id = filters.runId;
    }

    return {
      sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    };
  }

  private getItemRelativePath(
    item: Pick<QaItemRow, 'pdf_relative_path' | 'input_text_relative_path' | 'output_text_relative_path' | 'result_json_relative_path' | 'response_json_relative_path'>,
    kind: QaFileKind
  ) {
    if (kind === 'entrada') return item.input_text_relative_path;
    if (kind === 'saida') return item.output_text_relative_path;
    if (kind === 'resultado') return item.result_json_relative_path;
    if (kind === 'resposta') return item.response_json_relative_path;
    return item.pdf_relative_path;
  }

  private buildFileUrls(
    itemId: string,
    item: Pick<QaItemRow, 'pdf_relative_path' | 'input_text_relative_path' | 'output_text_relative_path' | 'result_json_relative_path' | 'response_json_relative_path'>
  ): Record<QaFileKind, string | null> {
    return {
      entrada: item.input_text_relative_path ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/itens/${itemId}/arquivos/entrada`) : null,
      saida: item.output_text_relative_path ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/itens/${itemId}/arquivos/saida`) : null,
      resultado: item.result_json_relative_path ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/itens/${itemId}/arquivos/resultado`) : null,
      resposta: item.response_json_relative_path ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/itens/${itemId}/arquivos/resposta`) : null,
      pdf: item.pdf_relative_path ? withPublicBasePath(`/api/lab-apoio/v1/consumer/qa/itens/${itemId}/arquivos/pdf`) : null,
    };
  }

  private resolveContentType(kind: QaFileKind) {
    if (kind === 'pdf') {
      return 'application/pdf';
    }
    if (kind === 'resultado' || kind === 'resposta') {
      return 'application/json; charset=utf-8';
    }
    return 'text/plain; charset=utf-8';
  }
}

let qaStorageSingleton: LabApoioQaStorage | null = null;

export function getLabApoioQaStorage() {
  if (!qaStorageSingleton) {
    qaStorageSingleton = new LabApoioQaStorage();
  }

  return qaStorageSingleton;
}
