import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { createLabApoioConsumerRouter } from './labApoio.consumer.routes.js';

async function withServer(
  deps: any,
  run: (baseUrl: string) => Promise<void>
) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  }));
  app.use('/api/lab-apoio/v1/consumer', createLabApoioConsumerRouter(deps));

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

async function requestJson(params: {
  baseUrl: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = {
    ...(params.headers ?? {}),
  };

  let body: string | undefined;
  if (params.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(params.body);
  }

  const response = await fetch(`${params.baseUrl}${params.path}`, {
    method: params.method,
    headers,
    body,
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

test('webhook route valida evento e dispara processamento automatico', async () => {
  let parsedArgs: any = null;
  let processArgs: any = null;

  await withServer({
    parseIncomingWebhook: (params: any) => {
      parsedArgs = params;
      return {
        headers: {
          tenantId: 'tenant-001',
          vinculoId: 'vinculo-001',
          eventId: 'event-1',
          timestamp: '2026-03-18T12:00:00.000Z',
          signature: 'abc',
          signatureAlg: 'sha256',
        },
        payload: {
          event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
          eventId: 'event-1',
          tenant: { id: 'tenant-001', nome: 'Tenant 1' },
          vinculo: { id: 'vinculo-001' },
        },
      };
    },
    processPendingExams: async (params: any) => {
      processArgs = params;
      return {
        tenantId: 'tenant-001',
        ambiente: 'hml',
        vinculoId: 'vinculo-001',
        triggerEvent: params.triggerEvent,
        triggerEventId: params.triggerEventId,
        batches: 1,
        attempted: 1,
        successCount: 1,
        errorCount: 0,
        duplicateCount: 0,
        completionReason: 'SEM_PENDENCIAS',
        results: [],
      };
    },
  }, async baseUrl => {
    const response = await requestJson({
      baseUrl,
      method: 'POST',
      path: '/api/lab-apoio/v1/consumer/webhook',
      headers: {
        'x-tenant-id': 'tenant-001',
        'x-lab-vinculo-id': 'vinculo-001',
        'x-lab-event-id': 'event-1',
        'x-lab-timestamp': '2026-03-18T12:00:00.000Z',
        'x-lab-signature': 'abc',
      },
      body: {
        event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
        eventId: 'event-1',
      },
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.autoProcessed, true);
    assert.equal(parsedArgs.rawBody, JSON.stringify({
      event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
      eventId: 'event-1',
    }));
    assert.equal(processArgs.tenantId, 'tenant-001');
  });
});

test('webhook de status nao dispara processamento automatico', async () => {
  let processCalls = 0;

  await withServer({
    parseIncomingWebhook: () => ({
      headers: {
        tenantId: 'tenant-001',
        vinculoId: 'vinculo-001',
        eventId: 'event-2',
        timestamp: '2026-03-18T12:00:00.000Z',
        signature: 'abc',
        signatureAlg: 'sha256',
      },
      payload: {
        event: 'LAB_APOIO_STATUS_SYNC',
        eventId: 'event-2',
        generatedAt: '2026-03-18T12:00:00.000Z',
        period: {
          from: '2026-03-18T11:00:00.000Z',
          to: '2026-03-18T12:00:00.000Z',
          sinceHours: 1,
        },
        tenant: { id: 'tenant-001', nome: 'Tenant 1' },
        vinculo: { id: 'vinculo-001', laboratorio: 'Lab' },
        metricas: {
          total: 1,
          processados: 1,
          erros: 0,
          resultadoJson: 1,
          resultadoPdf: 0,
          ultimoRecebimento: null,
          ultimoProcessamento: null,
        },
      },
    }),
    processPendingExams: async () => {
      processCalls += 1;
      throw new Error('nao deveria executar');
    },
  }, async baseUrl => {
    const response = await requestJson({
      baseUrl,
      method: 'POST',
      path: '/api/lab-apoio/v1/consumer/webhook',
      body: {
        event: 'LAB_APOIO_STATUS_SYNC',
        eventId: 'event-2',
      },
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.data.autoProcessed, false);
    assert.equal(processCalls, 0);
  });
});

test('webhook route retorna erro mapeado quando a assinatura falha', async () => {
  await withServer({
    parseIncomingWebhook: () => {
      throw new Error('falha de assinatura');
    },
  }, async baseUrl => {
    const response = await requestJson({
      baseUrl,
      method: 'POST',
      path: '/api/lab-apoio/v1/consumer/webhook',
      body: {
        event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
        eventId: 'event-3',
      },
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });
});

test('manual processing route usa tenantId do body', async () => {
  let captured: any = null;

  await withServer({
    processPendingExams: async (params: any) => {
      captured = params;
      return {
        tenantId: params.tenantId,
        ambiente: 'hml',
        vinculoId: 'vinculo-001',
        triggerEvent: 'MANUAL',
        triggerEventId: null,
        batches: 0,
        attempted: 0,
        successCount: 0,
        errorCount: 0,
        duplicateCount: 0,
        completionReason: 'SEM_PENDENCIAS',
        results: [],
      };
    },
  }, async baseUrl => {
    const response = await requestJson({
      baseUrl,
      method: 'POST',
      path: '/api/lab-apoio/v1/consumer/processar-pendentes',
      body: {
        tenantId: 'tenant-xyz',
        limit: 10,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(captured.tenantId, 'tenant-xyz');
    assert.equal(captured.limit, 10);
  });
});
