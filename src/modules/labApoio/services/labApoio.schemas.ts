import { z } from 'zod';

export function buildApiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    message: z.string().optional(),
    data: dataSchema,
  });
}

export const integrationTokenDataSchema = z.object({
  token: z.string().min(1),
  ambiente: z.string().min(1),
  vinculoId: z.string().min(1),
  tenantId: z.string().min(1),
  clienteId: z.string().min(1),
  labUuid: z.string().min(1),
  expiresIn: z.string().min(1),
  scope: z.literal('integracao').optional(),
}).passthrough();

export const pendingExamSchema = z.object({
  agendaExameItemId: z.number().int().positive(),
  agendaExameId: z.number().int().positive(),
  codexame: z.number().int().positive(),
  descricaoExame: z.string().nullish(),
  status: z.string().min(1),
  dataAgenda: z.string().nullish(),
  pacienteId: z.number().int().positive().nullish(),
});

export const pendingExamsDataSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  rows: z.array(pendingExamSchema),
});

export const pendingExamDetailItemSchema = z.object({
  agendaExameItemId: z.number().int().positive(),
  codexame: z.number().int().positive(),
  descricaoExame: z.string().nullish(),
  status: z.string().min(1),
  dataAgenda: z.string().nullish(),
  pacienteId: z.number().int().positive().nullish(),
  medicoId: z.number().int().positive().nullish(),
});

export const pendingExamDetailDataSchema = z.object({
  agendaExameId: z.number().int().positive(),
  itens: z.array(pendingExamDetailItemSchema).min(1),
});

export const resultadoRecebidoSchema = z.object({
  duplicado: z.boolean().optional(),
  message: z.string().optional(),
  resultadoId: z.string().optional(),
}).passthrough();

export const manualSyncRequestSchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const pendingExamsWebhookPayloadSchema = z.object({
  event: z.literal('LAB_APOIO_EXAMES_DISPONIVEIS'),
  eventId: z.string().min(1),
  generatedAt: z.string().datetime(),
  ambiente: z.string().min(1),
  tenant: z.object({
    id: z.string().min(1),
    nome: z.string().min(1),
  }),
  vinculo: z.object({
    id: z.string().min(1),
  }),
  laboratorio: z.object({
    nome: z.string().min(1),
    labUuid: z.string().min(1),
  }),
  pendencias: z.object({
    totalAtendimentosPendentes: z.number().int().nonnegative(),
    totalItensPendentes: z.number().int().nonnegative(),
  }),
  links: z.object({
    pendentes: z.string().min(1),
  }),
});

export const statusSyncWebhookPayloadSchema = z.object({
  event: z.literal('LAB_APOIO_STATUS_SYNC'),
  eventId: z.string().min(1),
  generatedAt: z.string().datetime(),
  period: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    sinceHours: z.number().int().positive(),
  }),
  tenant: z.object({
    id: z.string().min(1),
    nome: z.string().min(1),
  }),
  vinculo: z.object({
    id: z.string().min(1),
    laboratorio: z.string().min(1),
  }),
  metricas: z.object({
    total: z.number().int().nonnegative(),
    processados: z.number().int().nonnegative(),
    erros: z.number().int().nonnegative(),
    resultadoJson: z.number().int().nonnegative(),
    resultadoPdf: z.number().int().nonnegative(),
    ultimoRecebimento: z.string().datetime().nullable(),
    ultimoProcessamento: z.string().datetime().nullable(),
  }),
});

export const labApoioWebhookPayloadSchema = z.union([
  pendingExamsWebhookPayloadSchema,
  statusSyncWebhookPayloadSchema,
]);

export type IntegrationTokenData = z.infer<typeof integrationTokenDataSchema>;
export type PendingExam = z.infer<typeof pendingExamSchema>;
export type PendingExamsData = z.infer<typeof pendingExamsDataSchema>;
export type PendingExamDetail = z.infer<typeof pendingExamDetailDataSchema>;
export type ResultadoRecebido = z.infer<typeof resultadoRecebidoSchema>;
export type LabApoioWebhookPayload = z.infer<typeof labApoioWebhookPayloadSchema>;
