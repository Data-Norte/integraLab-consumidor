import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LabApoioApiClient } from './labApoio.api-client.js';
import { LabApoioConsumerError } from './labApoio.consumer.errors.js';

async function withHttpServer(
  handler: RequestListener,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('LabApoioApiClient envia credenciais de integracao para a API', async () => {
  await withHttpServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/api/lab-apoio/v1/integracao/auth/token');
      assert.deepEqual(JSON.parse(body), {
        vinculoId: 'vinculo-001',
        segredo: 'segredo-abc',
      });

      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        data: {
          token: 'jwt',
          ambiente: 'hml',
          vinculoId: 'vinculo-001',
          tenantId: 'tenant-001',
          clienteId: 'tenant-001',
          labUuid: 'lab-uuid-1',
          expiresIn: '15m',
          scope: 'integracao',
        },
      }));
    });
  }, async baseUrl => {
    const client = new LabApoioApiClient({
      baseUrl,
      timeoutMs: 3000,
    });

    const token = await client.issueIntegrationToken({
      vinculoId: 'vinculo-001',
      segredo: 'segredo-abc',
    });

    assert.equal(token.token, 'jwt');
  });
});

test('LabApoioApiClient envia headers de tenant e bearer para listar pendencias', async () => {
  await withHttpServer((req, res) => {
    assert.match(req.url || '', /\/api\/lab-apoio\/v1\/integracao\/exames\/pendentes/);
    assert.equal(req.headers.authorization, 'Bearer jwt');
    assert.equal(req.headers['x-tenant-id'], 'tenant-001');

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
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
            dataAgenda: null,
            pacienteId: null,
          },
        ],
      },
    }));
  }, async baseUrl => {
    const client = new LabApoioApiClient({
      baseUrl,
      timeoutMs: 3000,
    });

    const rows = await client.listPendingExams({
      token: 'jwt',
      tenantId: 'tenant-001',
    });

    assert.equal(rows.total, 1);
    assert.equal(rows.rows[0].agendaExameItemId, 200);
  });
});

test('LabApoioApiClient consulta o detalhe do exame pendente', async () => {
  await withHttpServer((req, res) => {
    assert.equal(req.url, '/api/lab-apoio/v1/integracao/exames/100');
    assert.equal(req.headers.authorization, 'Bearer jwt');
    assert.equal(req.headers['x-tenant-id'], 'tenant-001');

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        agendaExameId: 100,
        itens: [
          {
            agendaExameItemId: 200,
            codexame: 300,
            descricaoExame: 'Hemoglobina',
            status: 'PENDENTE',
            dataAgenda: null,
            pacienteId: null,
            medicoId: null,
          },
        ],
      },
    }));
  }, async baseUrl => {
    const client = new LabApoioApiClient({
      baseUrl,
      timeoutMs: 3000,
    });

    const detail = await client.getPendingExamDetail({
      token: 'jwt',
      tenantId: 'tenant-001',
      agendaExameId: 100,
    });

    assert.equal(detail.itens[0].agendaExameItemId, 200);
  });
});

test('LabApoioApiClient converte erro upstream em LabApoioConsumerError', async () => {
  await withHttpServer((_req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      message: 'Credenciais invalidas.',
    }));
  }, async baseUrl => {
    const client = new LabApoioApiClient({
      baseUrl,
      timeoutMs: 3000,
    });

    await assert.rejects(
      client.issueIntegrationToken({
        vinculoId: 'vinculo-001',
        segredo: 'segredo-abc',
      }),
      (error: unknown) => {
        assert.ok(error instanceof LabApoioConsumerError);
        assert.equal(error.statusCode, 401);
        assert.match(error.message, /Credenciais invalidas/);
        return true;
      }
    );
  });
});
