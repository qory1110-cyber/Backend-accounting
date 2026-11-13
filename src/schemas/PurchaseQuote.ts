import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const PurchaseQuoteLineSchema = z.object({
  description: z.string().trim().min(1, 'Deskripsi baris wajib diisi'),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const PurchaseQuoteCreateSchema = z.object({
  supplierId: z.string().uuid(),
  issueDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  lines: z.array(PurchaseQuoteLineSchema).min(1, 'Minimal 1 baris rincian'),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
// status hanya boleh 'cancelled' (membatalkan penawaran yang masih Active).
export const PurchaseQuoteUpdateSchema = z.object({
  supplierId: z.string().uuid().optional(),
  issueDate: IsoDateSchema.optional(),
  reference: z.string().max(100).nullable().optional(),
  description: z.string().nullable().optional(),
  lines: z.array(PurchaseQuoteLineSchema).min(1, 'Minimal 1 baris rincian').optional(),
  status: z.literal('cancelled').optional(),
});

export const PurchaseQuoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  status: z.enum(['active', 'cancelled']).optional(),
  supplierId: z.string().uuid().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const PurchaseQuoteLineResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const PurchaseQuoteResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  issueDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(['active', 'cancelled']),
  lines: z.array(PurchaseQuoteLineResponseSchema),
  totalAmount: z.number(),
});

export const PurchaseQuoteSingleResponseSchema = z.object({ data: PurchaseQuoteResponseSchema });
export const PurchaseQuoteParamsSchema = z.object({
  businessId: z.string().uuid(),
  purchaseQuoteId: z.string().uuid(),
});