import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const DebitNoteLineSchema = z.object({
  accountId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const DebitNoteCreateSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseInvoiceId: z.string().uuid().optional(), // opsional; bila diisi memotong sisa tagihan faktur
  issueDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  lines: z.array(DebitNoteLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const DebitNoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const DebitNoteLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const DebitNoteResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  purchaseInvoiceId: z.string().uuid().nullable(),
  purchaseInvoiceReference: z.string().nullable(),
  issueDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(DebitNoteLineResponseSchema),
  totalAmount: z.number(),
});

export const DebitNoteSingleResponseSchema = z.object({ data: DebitNoteResponseSchema });
export const DebitNoteParamsSchema = z.object({
  businessId: z.string().uuid(),
  debitNoteId: z.string().uuid(),
});