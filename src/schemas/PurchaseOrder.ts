import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const PurchaseOrderLineSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().optional(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const PurchaseOrderCreateSchema = z.object({
  supplierId: z.string().uuid(),
  orderDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  billingAddress: z.string().optional(),
  description: z.string().optional(),
  lines: z.array(PurchaseOrderLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const PurchaseOrderUpdateSchema = PurchaseOrderCreateSchema.partial();

export const PurchaseOrderListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const PurchaseOrderLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  description: z.string().nullable(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
  qtyInvoiced: z.number(),
});

export const PurchaseOrderResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  orderDate: z.string(),
  reference: z.string().nullable(),
  billingAddress: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(PurchaseOrderLineResponseSchema),
  totalAmount: z.number(),
  status: z.enum(['Unbilled', 'Partially Invoiced', 'Invoiced']),
  hasInvoices: z.boolean(),
});

export const PurchaseOrderSingleResponseSchema = z.object({ data: PurchaseOrderResponseSchema });
export const PurchaseOrderParamsSchema = z.object({
  businessId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
});