import { AxiosError } from 'axios';
import axios from 'axios';
import { ZodError } from 'zod';

import {
  buildApiSuccessSchema,
  integrationTokenDataSchema,
  pendingExamDetailDataSchema,
  pendingExamsDataSchema,
  qaHmlBatchDataSchema,
  resultadoRecebidoSchema,
  type IntegrationTokenData,
  type PendingExamDetail,
  type PendingExamsData,
  type QaHmlBatchData,
  type ResultadoRecebido,
} from './labApoio.schemas.js';
import { LabApoioConsumerError, toErrorMessage } from './labApoio.consumer.errors.js';

export type SendResultadoPayload = {
  agendaExameItemId: number;
  codexame: number;
  idempotencyKey: string;
  resultado: unknown;
  pdf?: {
    idempotencyKey?: string;
    nomeArquivo: string;
    pdfBase64: string;
    fornecId?: number;
  };
};

export type LabApoioApiClientLike = {
  issueIntegrationToken(params: {
    vinculoId: string;
    segredo: string;
    ambienteOperacao?: 'hml' | 'prd';
  }): Promise<IntegrationTokenData>;
  listPendingExams(params: {
    token: string;
    tenantId: string;
    page?: number;
    limit?: number;
  }): Promise<PendingExamsData>;
  getPendingExamDetail(params: {
    token: string;
    tenantId: string;
    agendaExameId: number;
  }): Promise<PendingExamDetail>;
  sendResultado(params: {
    token: string;
    tenantId: string;
    agendaExameId: number;
    payload: SendResultadoPayload;
  }): Promise<ResultadoRecebido>;
  generateQaHmlBatch?(params: {
    token: string;
    tenantId: string;
  }): Promise<QaHmlBatchData>;
};

function resolveErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }
  return fallback;
}

export class LabApoioApiClient implements LabApoioApiClientLike {
  private readonly http = axios.create();

  constructor(options: { baseUrl: string; timeoutMs: number }) {
    this.http.defaults.baseURL = options.baseUrl.replace(/\/+$/, '');
    this.http.defaults.timeout = options.timeoutMs;
  }

  async issueIntegrationToken(params: {
    vinculoId: string;
    segredo: string;
    ambienteOperacao?: 'hml' | 'prd';
  }) {
    try {
      const response = await this.http.post(
        '/api/lab-apoio/v1/integracao/auth/token',
        {
          vinculoId: params.vinculoId,
          segredo: params.segredo,
          ambienteOperacao: params.ambienteOperacao,
        }
      );

      const payload = buildApiSuccessSchema(integrationTokenDataSchema).parse(response.data);
      return payload.data;
    } catch (error) {
      throw this.normalizeError(error, 'Falha ao emitir token de integracao');
    }
  }

  async listPendingExams(params: {
    token: string;
    tenantId: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const response = await this.http.get(
        '/api/lab-apoio/v1/integracao/exames/pendentes',
        {
          params: {
            page: params.page ?? 1,
            limit: params.limit ?? 20,
          },
          headers: {
            Authorization: `Bearer ${params.token}`,
            'x-tenant-id': params.tenantId,
          },
        }
      );

      const payload = buildApiSuccessSchema(pendingExamsDataSchema).parse(response.data);
      return payload.data;
    } catch (error) {
      throw this.normalizeError(error, 'Falha ao consultar exames pendentes');
    }
  }

  async getPendingExamDetail(params: {
    token: string;
    tenantId: string;
    agendaExameId: number;
  }) {
    try {
      const response = await this.http.get(
        `/api/lab-apoio/v1/integracao/exames/${params.agendaExameId}`,
        {
          headers: {
            Authorization: `Bearer ${params.token}`,
            'x-tenant-id': params.tenantId,
          },
        }
      );

      const payload = buildApiSuccessSchema(pendingExamDetailDataSchema).parse(response.data);
      return payload.data;
    } catch (error) {
      throw this.normalizeError(error, 'Falha ao consultar detalhe do exame pendente');
    }
  }

  async sendResultado(params: {
    token: string;
    tenantId: string;
    agendaExameId: number;
    payload: SendResultadoPayload;
  }) {
    try {
      const response = await this.http.post(
        `/api/lab-apoio/v1/integracao/exames/${params.agendaExameId}/resultado`,
        params.payload,
        {
          headers: {
            Authorization: `Bearer ${params.token}`,
            'x-tenant-id': params.tenantId,
          },
        }
      );

      const payload = buildApiSuccessSchema(resultadoRecebidoSchema).parse(response.data);
      return payload.data;
    } catch (error) {
      throw this.normalizeError(error, 'Falha ao enviar resultado do exame');
    }
  }

  async generateQaHmlBatch(params: {
    token: string;
    tenantId: string;
  }) {
    try {
      const response = await this.http.post(
        '/api/lab-apoio/v1/integracao/qa/hml/agendamentos',
        {},
        {
          headers: {
            Authorization: `Bearer ${params.token}`,
            'x-tenant-id': params.tenantId,
          },
        }
      );

      const payload = buildApiSuccessSchema(qaHmlBatchDataSchema).parse(response.data);
      return payload.data;
    } catch (error) {
      throw this.normalizeError(error, 'Falha ao gerar agendamentos QA em homologacao');
    }
  }

  private normalizeError(error: unknown, context: string) {
    if (error instanceof LabApoioConsumerError) {
      return error;
    }

    if (error instanceof ZodError) {
      return new LabApoioConsumerError(
        502,
        'UPSTREAM_ERROR',
        `${context}: resposta invalida da API`,
        error.issues
      );
    }

    if (error instanceof AxiosError) {
      const statusCode = error.response?.status ?? 502;
      const message = resolveErrorMessage(error.response?.data, error.message);
      return new LabApoioConsumerError(
        statusCode >= 500 ? 502 : statusCode,
        statusCode === 401 ? 'UNAUTHORIZED' : 'UPSTREAM_ERROR',
        `${context}: ${message}`,
        error.response?.data
      );
    }

    return new LabApoioConsumerError(
      502,
      'UPSTREAM_ERROR',
      `${context}: ${toErrorMessage(error)}`
    );
  }
}
