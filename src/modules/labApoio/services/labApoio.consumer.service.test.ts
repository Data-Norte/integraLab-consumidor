import test from 'node:test';
import assert from 'node:assert/strict';

import { processPendingExams } from './labApoio.consumer.service.js';

function createQaStorageStub() {
  let itemSequence = 0;
  return {
    createRun: () => ({ id: 'run-qa' }),
    finishRun: () => undefined,
    recordItem: () => ({ id: `qa-item-${++itemSequence}` }),
  };
}

test('processPendingExams consome pendencias e envia resultado inline com pdf', async () => {
  const sentPayloads: any[] = [];
  let capturedTokenRequest: any = null;
  let listCalls = 0;

  const result = await processPendingExams({
    tenantId: 'tenant-001',
    triggerEvent: 'LAB_APOIO_EXAMES_DISPONIVEIS',
    triggerEventId: 'event-1',
  }, {
    vinculoId: 'vinculo-001',
    authSecret: 'segredo-123456789',
    fornecId: 77,
    sendInlinePdf: true,
    processingDelayMs: 0,
    maxBatches: 3,
    now: () => new Date('2026-03-18T12:00:00.000Z'),
    qaStorage: createQaStorageStub(),
    apiClient: {
      issueIntegrationToken: async params => {
        capturedTokenRequest = params;
        return {
          token: 'jwt-integracao',
          ambiente: 'prd',
          operationEnv: 'prd',
          vinculoId: 'vinculo-001',
          tenantId: 'tenant-001',
          clienteId: 'tenant-001',
          labUuid: 'lab-uuid-1',
          expiresIn: '15m',
          scope: 'integracao',
        };
      },
      listPendingExams: async () => {
        listCalls += 1;
        if (listCalls === 1) {
          return {
            page: 1,
            limit: 20,
            total: 2,
            rows: [
              {
                agendaExameId: 100,
                agendaExameItemId: 200,
                codexame: 300,
                descricaoExame: 'Hemoglobina',
                status: 'PENDENTE',
                dataAgenda: '2026-03-18T10:00:00.000Z',
                pacienteId: 1,
              },
              {
                agendaExameId: 101,
                agendaExameItemId: 201,
                codexame: 301,
                descricaoExame: 'Glicemia',
                status: 'PENDENTE',
                dataAgenda: '2026-03-18T10:10:00.000Z',
                pacienteId: 2,
              },
            ],
          };
        }

        return {
          page: 1,
          limit: 20,
          total: 0,
          rows: [],
        };
      },
      getPendingExamDetail: async ({ agendaExameId }) => ({
        agendaExameId,
        itens: [
          {
            agendaExameItemId: agendaExameId === 100 ? 200 : 201,
            codexame: agendaExameId === 100 ? 300 : 301,
            descricaoExame: agendaExameId === 100 ? 'Hemoglobina' : 'Glicemia',
            status: 'PENDENTE',
            dataAgenda: '2026-03-18T10:00:00.000Z',
            pacienteId: 1,
            medicoId: 10,
          },
        ],
      }),
      sendResultado: async ({ payload }) => {
        sentPayloads.push(payload);
        return {
          duplicado: false,
          resultadoId: `res-${payload.agendaExameItemId}`,
        };
      },
    },
  });

  assert.equal(result.successCount, 2);
  assert.equal(result.errorCount, 0);
  assert.equal(result.completionReason, 'SEM_PENDENCIAS');
  assert.deepEqual(capturedTokenRequest, {
    vinculoId: 'vinculo-001',
    segredo: 'segredo-123456789',
  });
  assert.equal(result.ambiente, 'prd');
  assert.equal(sentPayloads.length, 2);
  assert.equal(sentPayloads[0].idempotencyKey, 'resultado-100-200');
  assert.equal(sentPayloads[0].pdf.idempotencyKey, 'pdf-100-200');
  assert.equal(sentPayloads[0].pdf.fornecId, 77);
  assert.equal(sentPayloads[0].pdf.nomeArquivo, 'resultado-100-200.pdf');
  assert.match(sentPayloads[0].pdf.pdfBase64, /^[A-Za-z0-9+/=]+$/);
});

test('processPendingExams envia apenas resultado estruturado quando pdf inline esta desabilitado', async () => {
  const sentPayloads: any[] = [];

  const result = await processPendingExams({
    tenantId: 'tenant-001',
  }, {
    vinculoId: 'vinculo-001',
    authSecret: 'segredo-123456789',
    sendInlinePdf: false,
    processingDelayMs: 0,
    maxBatches: 1,
    qaStorage: createQaStorageStub(),
    apiClient: {
      issueIntegrationToken: async () => ({
        token: 'jwt-integracao',
        ambiente: 'hml',
        operationEnv: 'hml',
        vinculoId: 'vinculo-001',
        tenantId: 'tenant-001',
        clienteId: 'tenant-001',
        labUuid: 'lab-uuid-1',
        expiresIn: '15m',
      }),
      listPendingExams: async () => ({
        page: 1,
        limit: 20,
        total: 1,
        rows: [
          {
            agendaExameId: 100,
            agendaExameItemId: 200,
            codexame: 300,
            descricaoExame: 'Hemoglobina',
            status: 'PENDENTE',
            dataAgenda: '2026-03-18T10:00:00.000Z',
            pacienteId: 1,
          },
        ],
      }),
      getPendingExamDetail: async () => ({
        agendaExameId: 100,
        itens: [
          {
            agendaExameItemId: 200,
            codexame: 300,
            descricaoExame: 'Hemoglobina',
            status: 'PENDENTE',
            dataAgenda: '2026-03-18T10:00:00.000Z',
            pacienteId: 1,
            medicoId: 10,
          },
        ],
      }),
      sendResultado: async ({ payload }) => {
        sentPayloads.push(payload);
        return {
          duplicado: false,
        };
      },
    },
  });

  assert.equal(result.successCount, 1);
  assert.equal(sentPayloads[0].pdf, undefined);
});

test('processPendingExams encerra quando o lote retorna apenas itens ja tentados', async () => {
  let sendCalls = 0;

  const result = await processPendingExams({
    tenantId: 'tenant-001',
  }, {
    vinculoId: 'vinculo-001',
    authSecret: 'segredo-123456789',
    processingDelayMs: 0,
    maxBatches: 3,
    qaStorage: createQaStorageStub(),
    apiClient: {
      issueIntegrationToken: async () => ({
        token: 'jwt-integracao',
        ambiente: 'hml',
        operationEnv: 'hml',
        vinculoId: 'vinculo-001',
        tenantId: 'tenant-001',
        clienteId: 'tenant-001',
        labUuid: 'lab-uuid-1',
        expiresIn: '15m',
      }),
      listPendingExams: async () => ({
        page: 1,
        limit: 20,
        total: 1,
        rows: [
          {
            agendaExameId: 100,
            agendaExameItemId: 200,
            codexame: 300,
            descricaoExame: 'Hemoglobina',
            status: 'PENDENTE',
            dataAgenda: '2026-03-18T10:00:00.000Z',
            pacienteId: 1,
          },
        ],
      }),
      getPendingExamDetail: async () => ({
        agendaExameId: 100,
        itens: [
          {
            agendaExameItemId: 200,
            codexame: 300,
            descricaoExame: 'Hemoglobina',
            status: 'PENDENTE',
            dataAgenda: '2026-03-18T10:00:00.000Z',
            pacienteId: 1,
            medicoId: 10,
          },
        ],
      }),
      sendResultado: async () => {
        sendCalls += 1;
        throw new Error('falha simulada');
      },
    },
  });

  assert.equal(sendCalls, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.completionReason, 'LOTE_REPETIDO');
});

test('processPendingExams falha quando as credenciais de integracao nao estao configuradas', async () => {
  await assert.rejects(
    processPendingExams({
      tenantId: 'tenant-001',
    }, {
      vinculoId: '',
      authSecret: '',
    }),
    /Configure LAB_APOIO_VINCULO_ID e LAB_APOIO_AUTH_SECRET/
  );
});
