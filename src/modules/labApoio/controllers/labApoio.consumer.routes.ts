import express, { Request, Response } from 'express';
import { ZodError } from 'zod';

import env from '../../../config/env.js';
import { logEvent } from '../../../shared/logging/logger.js';
import { LabApoioConsumerError, toErrorMessage } from '../services/labApoio.consumer.errors.js';
import { processPendingExams, type ProcessPendingExamsResult } from '../services/labApoio.consumer.service.js';
import { manualSyncRequestSchema } from '../services/labApoio.schemas.js';
import { parseIncomingWebhook, type ParsedIncomingWebhook } from '../services/labApoio.webhook.service.js';

type ConsumerDeps = {
  parseIncomingWebhook: typeof parseIncomingWebhook;
  processPendingExams: typeof processPendingExams;
};

const defaultDeps: ConsumerDeps = {
  parseIncomingWebhook,
  processPendingExams,
};

function handleRouteError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Payload invalido.',
      details: error.issues,
    });
  }

  if (error instanceof LabApoioConsumerError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }

  logEvent('error', 'consumer_route_unexpected_error', {
    error: toErrorMessage(error),
  });

  return res.status(500).json({
    success: false,
    message: 'Erro interno no consumidor do laboratorio de apoio.',
  });
}

async function buildWebhookResponse(
  services: ConsumerDeps,
  req: Request
): Promise<{
  parsed: ParsedIncomingWebhook;
  result: ProcessPendingExamsResult | null;
  autoProcessed: boolean;
}> {
  const parsed = services.parseIncomingWebhook({
    headers: req.headers,
    rawBody: req.rawBody || '',
    body: req.body,
  });

  if (parsed.payload.event !== 'LAB_APOIO_EXAMES_DISPONIVEIS' || !env.AUTO_PROCESS_WEBHOOK) {
    return {
      parsed,
      result: null,
      autoProcessed: false,
    };
  }

  const result = await services.processPendingExams({
    tenantId: parsed.headers.tenantId,
    triggerEvent: parsed.payload.event,
    triggerEventId: parsed.headers.eventId,
  });

  return {
    parsed,
    result,
    autoProcessed: true,
  };
}

export function createLabApoioConsumerRouter(
  deps: Partial<ConsumerDeps> = {}
) {
  const services = {
    ...defaultDeps,
    ...deps,
  };

  const router = express.Router();

  router.get('/health', (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        service: 'integralab-consumidor',
      },
    });
  });

  router.post('/webhook', async (req: Request, res: Response) => {
    try {
      const { parsed, result, autoProcessed } = await buildWebhookResponse(services, req);

      return res.status(202).json({
        success: true,
        message: autoProcessed
          ? 'Webhook validado e processamento iniciado.'
          : 'Webhook validado.',
        data: {
          event: parsed.payload.event,
          eventId: parsed.headers.eventId,
          tenantId: parsed.headers.tenantId,
          vinculoId: parsed.headers.vinculoId,
          autoProcessed,
          processing: result,
        },
      });
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  router.post('/processar-pendentes', async (req: Request, res: Response) => {
    try {
      const body = manualSyncRequestSchema.parse(req.body ?? {});
      const tenantId = body.tenantId ?? env.LAB_APOIO_TENANT_ID;

      if (!tenantId) {
        throw new LabApoioConsumerError(
          400,
          'VALIDATION_ERROR',
          'Informe tenantId no body ou configure LAB_APOIO_TENANT_ID.'
        );
      }

      const result = await services.processPendingExams({
        tenantId,
        limit: body.limit,
        triggerEvent: 'MANUAL',
      });

      return res.status(200).json({
        success: true,
        message: 'Processamento manual executado com sucesso.',
        data: result,
      });
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  return router;
}

export default createLabApoioConsumerRouter();
