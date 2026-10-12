import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

export const SalesInvoiceLineSchema = z.object({
  accountId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});

export const SalesInvoiceCreateSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema.optional(),
  reference: z.string().max(100).optional(),
  billingAddress: z.string().optional(),
  description: z.string().optional(),
  lines: z.array(SalesInvoiceLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const SalesInvoiceUpdateSchema = SalesInvoiceCreateSchema.partial();

export const SalesInvoiceLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  subtotal: z.number(),
});

export const SalesInvoiceResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  reference: z.string().nullable(),
  billingAddress: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'sent', 'void']),
  lines: z.array(SalesInvoiceLineResponseSchema),
  // Dihitung real-time, sesuai §10.3 dokumen analisis (bukan kolom database).
  invoiceAmount: z.number(),
  balanceDue: z.number(),
  // null kalau draft/void - cuma relevan saat status 'sent' (§10.5).
  paymentStatus: z.enum(['Unpaid', 'Overdue', 'Paid']).nullable(),
});

export const SalesInvoiceListResponseSchema = z.object({ data: z.array(SalesInvoiceResponseSchema) });
export const SalesInvoiceSingleResponseSchema = z.object({ data: SalesInvoiceResponseSchema });
export const SalesInvoiceParamsSchema = z.object({
  businessId: z.string().uuid(),
  salesInvoiceId: z.string().uuid(),
});

export const SalesInvoiceTotalsResponseSchema = z.object({
  data: z.object({
    totalInvoiceAmount: z.number(),
    totalBalanceDue: z.number(),
  }),
});