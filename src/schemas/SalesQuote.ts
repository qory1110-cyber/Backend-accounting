import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const SalesQuoteLineSchema = z.object({
  description: z.string().trim().min(1, 'Deskripsi baris wajib diisi'),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const SalesQuoteCreateSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: IsoDateSchema,
  validDays: z.coerce.number().int().min(0).optional(),
  reference: z.string().max(100).optional(),
  billingAddress: z.string().optional(),
  description: z.string().optional(),
  lines: z.array(SalesQuoteLineSchema).min(1, 'Minimal 1 baris rincian'),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
export const SalesQuoteUpdateSchema = z.object({
  customerId: z.string().uuid().optional(),
  issueDate: IsoDateSchema.optional(),
  validDays: z.coerce.number().int().min(0).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  billingAddress: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lines: z.array(SalesQuoteLineSchema).min(1, 'Minimal 1 baris rincian').optional(),
});

export const SalesQuoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const SalesQuoteLineResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const SalesQuoteResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  issueDate: z.string(),
  validDays: z.number().nullable(),
  expiryDate: z.string().nullable(),
  reference: z.string().nullable(),
  billingAddress: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(SalesQuoteLineResponseSchema),
  totalAmount: z.number(),
});

export const SalesQuoteSingleResponseSchema = z.object({ data: SalesQuoteResponseSchema });
export const SalesQuoteParamsSchema = z.object({
  businessId: z.string().uuid(),
  salesQuoteId: z.string().uuid(),
});