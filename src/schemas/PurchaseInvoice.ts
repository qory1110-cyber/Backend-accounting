import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

export const PurchaseInvoiceLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid().optional(),
  accountId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const PurchaseInvoiceCreateSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  issueDate: z.string(), // YYYY-MM-DD
  dueDate: z.string().optional(),
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  lines: z.array(PurchaseInvoiceLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const PurchaseInvoiceUpdateSchema = PurchaseInvoiceCreateSchema.partial();

export const PurchaseInvoiceLineResponseSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const PurchaseInvoiceResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  // Nomor referensi PO untuk kolom "Order number" di tampilan faktur.
  purchaseOrderReference: z.string().nullable(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'approved', 'void']),
  lines: z.array(PurchaseInvoiceLineResponseSchema),
  invoiceAmount: z.number(),
  balanceDue: z.number(),
  // null kalau draft/void - hanya relevan saat status 'approved'.
  paymentStatus: z.enum(['Coming due', 'Overdue', 'Paid in full']).nullable(),
});

export const PurchaseInvoiceListResponseSchema = z.object({ data: z.array(PurchaseInvoiceResponseSchema) });
export const PurchaseInvoiceSingleResponseSchema = z.object({ data: PurchaseInvoiceResponseSchema });
export const PurchaseInvoiceParamsSchema = z.object({
  businessId: z.string().uuid(),
  purchaseInvoiceId: z.string().uuid(),
});

export const PurchaseInvoiceTotalsResponseSchema = z.object({
  data: z.object({
    totalInvoiceAmount: z.number(),
    totalBalanceDue: z.number(),
  }),
});