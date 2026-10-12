import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema, createPaginatedResponseSchema } from './globals.js';

export const InterAccountTransferCreateSchema = z.object({
  transferDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  paidFromBankAccountId: z.string().uuid(),
  receivedInBankAccountId: z.string().uuid(),
  amount: z.coerce.number().positive(),
});

export const InterAccountTransferResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  transferDate: z.string(),
  reference: z.string(),
  description: z.string().nullable(),
  paidFromBankAccountId: z.string().uuid(),
  paidFromBankAccountName: z.string(),
  receivedInBankAccountId: z.string().uuid(),
  receivedInBankAccountName: z.string(),
  amount: z.number(),
  paidFromCleared: z.boolean(),
  receivedInCleared: z.boolean(),
});

export const InterAccountTransferListResponseSchema = createPaginatedResponseSchema(
  InterAccountTransferResponseSchema,
);
export const InterAccountTransferSingleResponseSchema = z.object({ data: InterAccountTransferResponseSchema });
export const InterAccountTransferParamsSchema = z.object({
  businessId: z.string().uuid(),
  transferId: z.string().uuid(),
});
export const InterAccountTransferListQuerySchema = PaginationQuerySchema;

export const SetTransferClearedSchema = z
  .object({
    paidFromCleared: z.boolean().optional(),
    receivedInCleared: z.boolean().optional(),
  })
  .refine((b) => b.paidFromCleared !== undefined || b.receivedInCleared !== undefined, {
    message: 'Isi paidFromCleared atau receivedInCleared',
  });