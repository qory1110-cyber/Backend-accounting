import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const CreditNoteLineSchema = z.object({
  accountId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const CreditNoteCreateSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  lines: z.array(CreditNoteLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const CreditNoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const CreditNoteLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const CreditNoteResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  issueDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(CreditNoteLineResponseSchema),
  totalAmount: z.number(),
});

export const CreditNoteSingleResponseSchema = z.object({ data: CreditNoteResponseSchema });
export const CreditNoteParamsSchema = z.object({
  businessId: z.string().uuid(),
  creditNoteId: z.string().uuid(),
});