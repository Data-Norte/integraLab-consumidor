import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import env from '../../../config/env.js';
import { LabApoioConsumerError } from './labApoio.consumer.errors.js';
import { getLabApoioQaRuntimeConfig } from './labApoio.qa.runtime-config.js';
import {
  labApoioWebhookPayloadSchema,
  type LabApoioWebhookPayload,
} from './labApoio.schemas.js';

type ParsedWebhookHeaders = {
  tenantId: string;
  vinculoId: string;
  eventId: string;
  timestamp: string;
  signature: string;
  signatureAlg: string;
};

export type ParsedIncomingWebhook = {
  headers: ParsedWebhookHeaders;
  payload: LabApoioWebhookPayload;
};

function readHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function parseHeaders(headers: IncomingHttpHeaders): ParsedWebhookHeaders {
  const tenantId = readHeader(headers, 'x-tenant-id');
  const vinculoId = readHeader(headers, 'x-lab-vinculo-id');
  const eventId = readHeader(headers, 'x-lab-event-id');
  const timestamp = readHeader(headers, 'x-lab-timestamp');
  const signature = readHeader(headers, 'x-lab-signature');
  const signatureAlg = readHeader(headers, 'x-lab-signature-alg') || 'sha256';

  if (!tenantId || !vinculoId || !eventId || !timestamp || !signature) {
    throw new LabApoioConsumerError(
      400,
      'VALIDATION_ERROR',
      'Headers obrigatorios do webhook nao foram informados.'
    );
  }

  return {
    tenantId,
    vinculoId,
    eventId,
    timestamp,
    signature,
    signatureAlg,
  };
}

function safeCompareHex(left: string, right: string) {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function signWebhookPayload(secret: string, timestamp: string, eventId: string, payload: string) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.${payload}`)
    .digest('hex');
}

export function parseIncomingWebhook(params: {
  headers: IncomingHttpHeaders;
  rawBody: string;
  body: unknown;
  secret?: string;
  maxAgeMs?: number;
  now?: () => Date;
}): ParsedIncomingWebhook {
  const secret = params.secret ?? getLabApoioQaRuntimeConfig().getResolvedSecrets().webhookSecret;

  if (!secret) {
    throw new LabApoioConsumerError(
      500,
      'CONFIGURATION_ERROR',
      'Configure LAB_APOIO_WEBHOOK_SECRET no .env ou na tela pública de QA para validar o webhook.'
    );
  }
  if (!params.rawBody) {
    throw new LabApoioConsumerError(400, 'VALIDATION_ERROR', 'Body bruto do webhook nao foi capturado.');
  }

  const headers = parseHeaders(params.headers);
  if (headers.signatureAlg.toLowerCase() !== 'sha256') {
    throw new LabApoioConsumerError(400, 'VALIDATION_ERROR', 'Algoritmo de assinatura nao suportado.');
  }

  const payload = labApoioWebhookPayloadSchema.parse(params.body);
  const timestampMs = Date.parse(headers.timestamp);
  if (Number.isNaN(timestampMs)) {
    throw new LabApoioConsumerError(400, 'VALIDATION_ERROR', 'Timestamp do webhook invalido.');
  }

  const now = params.now ?? (() => new Date());
  const ageMs = Math.abs(now().getTime() - timestampMs);
  if (ageMs > (params.maxAgeMs ?? env.WEBHOOK_MAX_AGE_MS)) {
    throw new LabApoioConsumerError(401, 'UNAUTHORIZED', 'Webhook fora da janela de validade.');
  }

  if (headers.eventId !== payload.eventId) {
    throw new LabApoioConsumerError(400, 'VALIDATION_ERROR', 'Header e payload possuem eventId diferente.');
  }
  if (headers.tenantId !== payload.tenant.id) {
    throw new LabApoioConsumerError(403, 'FORBIDDEN', 'Webhook nao autorizado para o tenant informado.');
  }
  if (headers.vinculoId !== payload.vinculo.id) {
    throw new LabApoioConsumerError(403, 'FORBIDDEN', 'Webhook nao autorizado para o vinculo informado.');
  }

  const expectedSignature = signWebhookPayload(secret, headers.timestamp, headers.eventId, params.rawBody);
  if (!safeCompareHex(expectedSignature, headers.signature)) {
    throw new LabApoioConsumerError(401, 'UNAUTHORIZED', 'Assinatura do webhook invalida.');
  }

  return {
    headers,
    payload,
  };
}
