import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { createLabApoioQaRouter } from './labApoio.qa.routes.js';
import { getLabApoioQaStorage } from '../services/labApoio.qa.storage.js';

async function withServer(
  deps: Record<string, unknown> = {},
  run: (baseUrl: string) => Promise<void>
) {
  const app = express();
  app.use(express.json());
  app.use('/api/lab-apoio/v1/consumer/qa', createLabApoioQaRouter(deps));

  const server = await new Promise<import('node:http').Server>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function requestJson(baseUrl: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json();
  return {
    status: response.status,
    data,
  };
}

test('qa routes listam overview e detalhe do item gravado localmente', async () => {
  const storage = getLabApoioQaStorage();
  storage.clearAllStorage();

  const run = storage.createRun({
    tenantId: 'tenant-qa',
    tenantName: 'Tenant QA',
    vinculoId: 'vinculo-qa',
    source: 'MANUAL',
    triggerEvent: 'MANUAL',
    triggerEventId: null,
  });

  const item = storage.recordItem({
    runId: run.id,
    tenantId: 'tenant-qa',
    tenantName: 'Tenant QA',
    vinculoId: 'vinculo-qa',
    ambiente: 'hml',
    agendaExameId: 123,
    agendaExameItemId: 456,
    codexame: 789,
    descricaoExame: 'Hemograma',
    status: 'SUCESSO',
    pendingExam: { agendaExameId: 123, agendaExameItemId: 456 },
    examDetail: { agendaExameId: 123, itens: [{ agendaExameItemId: 456 }] },
    generatedResult: { status: 'CONCLUIDO', parametros: [{ descricao: 'Hemoglobina', valor: '13.2' }] },
    sendPayload: { resultado: { status: 'CONCLUIDO' } },
    apiResponse: { duplicado: false, resultadoId: 'res-1' },
    resultPreview: 'Hemoglobina: 13.2 g/dL',
    pdfBuffer: Buffer.from('%PDF-1.4\n%%EOF', 'utf8'),
    pdfFileName: 'resultado-123-456.pdf',
  });

  storage.finishRun({
    runId: run.id,
    ambiente: 'hml',
    batches: 1,
    attempted: 1,
    successCount: 1,
    errorCount: 0,
    duplicateCount: 0,
    completionReason: 'SEM_PENDENCIAS',
    summary: { runId: run.id, successCount: 1 },
  });

  await withServer({}, async baseUrl => {
    const overview = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/overview?tenantId=tenant-qa');
    assert.equal(overview.status, 200);
    assert.equal(overview.data.success, true);
    assert.equal(overview.data.data.rows.length, 1);
    assert.equal(overview.data.data.rows[0].id, item.id);

    const detail = await requestJson(baseUrl, `/api/lab-apoio/v1/consumer/qa/itens/${item.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.data.run.id, run.id);
    assert.equal(detail.data.data.generatedResult.status, 'CONCLUIDO');

    const pdfResponse = await fetch(`${baseUrl}/api/lab-apoio/v1/consumer/qa/itens/${item.id}/arquivos/pdf`);
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  });

  storage.clearAllStorage();
});

test('qa routes limpam storage local', async () => {
  const storage = getLabApoioQaStorage();
  storage.clearAllStorage();

  const run = storage.createRun({
    tenantId: 'tenant-clean',
    source: 'MANUAL',
    triggerEvent: 'MANUAL',
  });

  storage.finishRun({
    runId: run.id,
    ambiente: 'hml',
    batches: 0,
    attempted: 0,
    successCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    completionReason: 'SEM_PENDENCIAS',
    summary: { runId: run.id },
  });

  await withServer({}, async baseUrl => {
    const cleared = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/storage', { method: 'DELETE' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.success, true);

    const overview = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/overview');
    assert.equal(overview.data.data.summary.totalItems, 0);
  });
});

test('qa routes executam as acoes publicas de processamento e geracao', async () => {
  let processCaptured: any = null;
  let generateCaptured: any = null;

  await withServer({
    processPendingExams: async (params: any) => {
      processCaptured = params;
      return {
        runId: 'run-qa',
        qaUrl: '/qa?runId=run-qa',
        tenantId: params.tenantId,
        tenantName: 'Tenant QA',
        ambiente: 'hml',
        vinculoId: 'vinculo-qa',
        triggerEvent: params.triggerEvent,
        triggerEventId: null,
        batches: 1,
        attempted: 5,
        successCount: 5,
        errorCount: 0,
        duplicateCount: 0,
        completionReason: 'SEM_PENDENCIAS',
        results: [],
      };
    },
    generateQaHmlAgendamentos: async (params: any) => {
      generateCaptured = params;
      return {
        vinculoId: 'vinculo-qa',
        tenantId: 'tenant-qa',
        tenantNome: 'Tenant QA',
        ambiente: 'hml',
        operationEnv: 'hml',
        pendingBefore: 0,
        cleanedAgendaExameIds: [1, 2],
        generatedCount: 5,
        rows: [],
        createdAt: new Date().toISOString(),
      };
    },
  }, async baseUrl => {
    const processResponse = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/acoes/processar-pendentes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'tenant-qa',
        limit: 5,
      }),
    });

    assert.equal(processResponse.status, 200);
    assert.equal(processResponse.data.success, true);
    assert.equal(processCaptured.tenantId, 'tenant-qa');
    assert.equal(processCaptured.triggerEvent, 'QA_PUBLICO');

    const generateResponse = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/acoes/gerar-agendamentos-hml', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'tenant-qa',
      }),
    });

    assert.equal(generateResponse.status, 200);
    assert.equal(generateResponse.data.success, true);
    assert.equal(generateCaptured.tenantId, 'tenant-qa');
    assert.equal(generateResponse.data.data.generatedCount, 5);
  });
});

test('qa routes consultam e atualizam os segredos persistidos do QA', async () => {
  let updateCaptured: any = null;
  let currentState = {
    authSecret: {
      configured: true,
      source: 'env',
      preview: 'aut******123',
    },
    webhookSecret: {
      configured: false,
      source: 'missing',
      preview: null,
    },
    updatedAt: null,
  };

  await withServer({
    runtimeConfig: {
      getPublicState: () => currentState,
      updateSecrets: (input: any) => {
        updateCaptured = input;
        currentState = {
          authSecret: {
            configured: true,
            source: input.authSecret ? 'override' : 'env',
            preview: 'nov******ret',
          },
          webhookSecret: {
            configured: true,
            source: input.webhookSecret ? 'override' : 'missing',
            preview: 'web******ret',
          },
          updatedAt: '2026-03-31T12:00:00.000Z',
        };
        return currentState;
      },
    },
  }, async baseUrl => {
    const current = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/configuracao/segredos');
    assert.equal(current.status, 200);
    assert.equal(current.data.success, true);
    assert.equal(current.data.data.authSecret.source, 'env');
    assert.equal(current.data.data.webhookSecret.configured, false);

    const updated = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/configuracao/segredos', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        authSecret: 'novo-auth-secret',
        webhookSecret: 'novo-webhook-secret',
      }),
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.data.success, true);
    assert.equal(updateCaptured.authSecret, 'novo-auth-secret');
    assert.equal(updateCaptured.webhookSecret, 'novo-webhook-secret');
    assert.equal(updated.data.data.authSecret.source, 'override');
    assert.equal(updated.data.data.webhookSecret.source, 'override');
  });
});
