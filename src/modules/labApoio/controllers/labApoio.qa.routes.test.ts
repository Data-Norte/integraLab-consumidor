import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { createLabApoioQaRouter } from './labApoio.qa.routes.js';
import { getLabApoioQaStorage } from '../services/labApoio.qa.storage.js';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use('/api/lab-apoio/v1/consumer/qa', createLabApoioQaRouter());

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

  await withServer(async baseUrl => {
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

  await withServer(async baseUrl => {
    const cleared = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/storage', { method: 'DELETE' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.success, true);

    const overview = await requestJson(baseUrl, '/api/lab-apoio/v1/consumer/qa/overview');
    assert.equal(overview.data.data.summary.totalItems, 0);
  });
});
