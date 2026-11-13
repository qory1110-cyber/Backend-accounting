import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const WithholdingTaxReceiptCreateSchema = z.object({
  customerId: z.string().uuid(),
  receiptDate: IsoDateSchema,
  amount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
  description: z.string().optional(),
});

// Update: semua field opsional. Description boleh dikosongkan dengan null.
export const WithholdingTaxReceiptUpdateSchema = z.object({
  customerId: z.string().uuid().optional(),
  receiptDate: IsoDateSchema.optional(),
  amount: z.coerce.number().positive('Jumlah harus lebih dari 0').optional(),
  description: z.string().nullable().optional(),
});

export const WithholdingTaxReceiptListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const WithholdingTaxReceiptResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string().nullable(),
  receiptDate: z.string(),
  amount: z.number(),
  description: z.string().nullable(),
});

export const WithholdingTaxReceiptSingleResponseSchema = z.object({
  data: WithholdingTaxReceiptResponseSchema,
});

export const WithholdingTaxReceiptParamsSchema = z.object({
  businessId: z.string().uuid(),
  withholdingTaxReceiptId: z.string().uuid(),
});