import express, { Request, Response } from 'express';
import fs from 'node:fs';
import { ZodError, z } from 'zod';

import { getLabApoioQaStorage } from '../services/labApoio.qa.storage.js';

const overviewQuerySchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
  status: z.enum(['SUCESSO', 'ERRO']).optional(),
  runId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const itemParamsSchema = z.object({
  itemId: z.string().trim().min(1),
});

const runParamsSchema = z.object({
  runId: z.string().trim().min(1),
});

const itemFileParamsSchema = itemParamsSchema.extend({
  kind: z.enum(['entrada', 'saida', 'resultado', 'resposta', 'pdf']),
});

const runFileParamsSchema = runParamsSchema.extend({
  kind: z.enum(['contexto', 'webhook', 'resumo']),
});

function handleRouteError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Parametros invalidos para a tela publica de QA.',
      details: error.issues,
    });
  }

  const message = error instanceof Error ? error.message : 'Erro interno na tela publica de QA.';
  return res.status(500).json({
    success: false,
    message,
  });
}

export function createLabApoioQaRouter() {
  const router = express.Router();
  const storage = getLabApoioQaStorage();

  router.get('/overview', (req: Request, res: Response) => {
    try {
      const query = overviewQuerySchema.parse(req.query);
      const data = storage.getOverview(query);
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  router.get('/itens/:itemId', (req: Request, res: Response) => {
    try {
      const { itemId } = itemParamsSchema.parse(req.params);
      const item = storage.getItemDetail(itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Item de QA nao encontrado.',
        });
      }

      return res.status(200).json({
        success: true,
        data: item,
      });
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  router.get('/itens/:itemId/arquivos/:kind', (req: Request, res: Response) => {
    try {
      const { itemId, kind } = itemFileParamsSchema.parse(req.params);
      const file = storage.resolveItemFile(itemId, kind);
      if (!file) {
        return res.status(404).json({
          success: false,
          message: 'Arquivo do item QA nao encontrado.',
        });
      }

      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', kind === 'pdf' ? `inline; filename="${file.fileName}"` : `attachment; filename="${file.fileName}"`);
      return res.send(fs.readFileSync(file.absolutePath));
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  router.get('/runs/:runId/arquivos/:kind', (req: Request, res: Response) => {
    try {
      const { runId, kind } = runFileParamsSchema.parse(req.params);
      const file = storage.resolveRunFile(runId, kind);
      if (!file) {
        return res.status(404).json({
          success: false,
          message: 'Arquivo da execucao QA nao encontrado.',
        });
      }

      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      return res.send(fs.readFileSync(file.absolutePath));
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  router.delete('/storage', (_req: Request, res: Response) => {
    try {
      const data = storage.clearAllStorage();
      return res.status(200).json({
        success: true,
        message: 'Diretorios e base local de QA foram limpos.',
        data,
      });
    } catch (error) {
      return handleRouteError(res, error);
    }
  });

  return router;
}

export default createLabApoioQaRouter();
