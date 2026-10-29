import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const SalesOrderLineSchema = z.object({
  description: z.string().trim().min(1, 'Deskripsi baris wajib diisi'),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const SalesOrderCreateSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  lines: z.array(SalesOrderLineSchema).min(1, 'Minimal 1 baris rincian'),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
export const SalesOrderUpdateSchema = z.object({
  customerId: z.string().uuid().optional(),
  issueDate: IsoDateSchema.optional(),
  reference: z.string().max(100).nullable().optional(),
  description: z.string().nullable().optional(),
  lines: z.array(SalesOrderLineSchema).min(1, 'Minimal 1 baris rincian').optional(),
});

export const SalesOrderListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const SalesOrderLineResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const SalesOrderResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  issueDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(SalesOrderLineResponseSchema),
  totalAmount: z.number(),
});

export const SalesOrderSingleResponseSchema = z.object({ data: SalesOrderResponseSchema });
export const SalesOrderParamsSchema = z.object({
  businessId: z.string().uuid(),
  salesOrderId: z.string().uuid(),
});