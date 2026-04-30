import test from 'node:test';
import assert from 'node:assert/strict';

import { LabApoioConsumerError } from './labApoio.consumer.errors.js';
import { parseIncomingWebhook, signWebhookPayload } from './labApoio.webhook.service.js';

test('parseIncomingWebhook valida assinatura e retorna payload tipado', () => {
  const timestamp = '2026-03-18T12:00:00.000Z';
  const eventId = 'event-1';
  const payload = {
    event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
    eventId,
    generatedAt: timestamp,
    ambiente: 'hml',
    tenant: {
      id: 'tenant-001',
      nome: 'Tenant 1',
    },
    vinculo: {
      id: 'vinculo-001',
    },
    laboratorio: {
      nome: 'Lab Alpha',
      labUuid: 'lab-uuid-1',
    },
    pendencias: {
      totalAtendimentosPendentes: 2,
      totalItensPendentes: 3,
    },
    links: {
      pendentes: '/lab-apoio/v1/integracao/exames/pendentes',
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = signWebhookPayload('webhook-secret', timestamp, eventId, rawBody);

  const parsed = parseIncomingWebhook({
    headers: {
      'x-tenant-id': 'tenant-001',
      'x-lab-vinculo-id': 'vinculo-001',
      'x-lab-event-id': eventId,
      'x-lab-timestamp': timestamp,
      'x-lab-signature': signature,
      'x-lab-signature-alg': 'sha256',
    },
    rawBody,
    body: payload,
    secret: 'webhook-secret',
    maxAgeMs: 300000,
    now: () => new Date(timestamp),
  });

  assert.equal(parsed.headers.tenantId, 'tenant-001');
  assert.equal(parsed.payload.event, 'LAB_APOIO_EXAMES_DISPONIVEIS');
});

test('parseIncomingWebhook rejeita assinatura invalida', () => {
  const payload = {
    event: 'LAB_APOIO_EXAMES_DISPONIVEIS',
    eventId: 'event-1',
    generatedAt: '2026-03-18T12:00:00.000Z',
    ambiente: 'hml',
    tenant: {
      id: 'tenant-001',
      nome: 'Tenant 1',
    },
    vinculo: {
      id: 'vinculo-001',
    },
    laboratorio: {
      nome: 'Lab Alpha',
      labUuid: 'lab-uuid-1',
    },
    pendencias: {
      totalAtendimentosPendentes: 2,
      totalItensPendentes: 3,
    },
    links: {
      pendentes: '/lab-apoio/v1/integracao/exames/pendentes',
    },
  };

  assert.throws(() => {
    parseIncomingWebhook({
      headers: {
        'x-tenant-id': 'tenant-001',
        'x-lab-vinculo-id': 'vinculo-001',
        'x-lab-event-id': 'event-1',
        'x-lab-timestamp': '2026-03-18T12:00:00.000Z',
        'x-lab-signature': 'deadbeef',
        'x-lab-signature-alg': 'sha256',
      },
      rawBody: JSON.stringify(payload),
      body: payload,
      secret: 'webhook-secret',
      maxAgeMs: 300000,
      now: () => new Date('2026-03-18T12:00:00.000Z'),
    });
  }, (error: unknown) => {
    assert.ok(error instanceof LabApoioConsumerError);
    assert.equal(error.statusCode, 401);
    return true;
  });
});
