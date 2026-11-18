import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const GoodsReceiptLineSchema = z.object({
  description: z.string().trim().min(1, 'Deskripsi baris wajib diisi'),
  qty: z.coerce.number().positive(),
});

export const GoodsReceiptCreateSchema = z.object({
  supplierId: z.string().uuid(),
  receiptDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  purchaseOrderId: z.string().uuid().optional(),
  purchaseInvoiceId: z.string().uuid().optional(),
  description: z.string().optional(),
  lines: z.array(GoodsReceiptLineSchema).min(1, 'Minimal 1 baris rincian'),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
export const GoodsReceiptUpdateSchema = z.object({
  supplierId: z.string().uuid().optional(),
  receiptDate: IsoDateSchema.optional(),
  reference: z.string().max(100).nullable().optional(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  purchaseInvoiceId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  lines: z.array(GoodsReceiptLineSchema).min(1, 'Minimal 1 baris rincian').optional(),
});

export const GoodsReceiptListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const GoodsReceiptLineResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.string(),
});

export const GoodsReceiptResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  purchaseOrderReference: z.string().nullable(),
  purchaseInvoiceId: z.string().uuid().nullable(),
  purchaseInvoiceReference: z.string().nullable(),
  receiptDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  totalQty: z.number(),
  lines: z.array(GoodsReceiptLineResponseSchema),
});

export const GoodsReceiptSingleResponseSchema = z.object({ data: GoodsReceiptResponseSchema });
export const GoodsReceiptParamsSchema = z.object({
  businessId: z.string().uuid(),
  goodsReceiptId: z.string().uuid(),
});