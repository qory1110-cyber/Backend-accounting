import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const DeliveryNoteLineSchema = z.object({
  description: z.string().trim().min(1, 'Deskripsi baris wajib diisi'),
  qty: z.coerce.number().positive(),
});

export const DeliveryNoteCreateSchema = z.object({
  customerId: z.string().uuid(),
  deliveryDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  salesOrderId: z.string().uuid().optional(),
  salesInvoiceId: z.string().uuid().optional(),
  deliveryAddress: z.string().optional(),
  description: z.string().optional(),
  lines: z.array(DeliveryNoteLineSchema).min(1, 'Minimal 1 baris rincian'),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
export const DeliveryNoteUpdateSchema = z.object({
  customerId: z.string().uuid().optional(),
  deliveryDate: IsoDateSchema.optional(),
  reference: z.string().max(100).nullable().optional(),
  salesOrderId: z.string().uuid().nullable().optional(),
  salesInvoiceId: z.string().uuid().nullable().optional(),
  deliveryAddress: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lines: z.array(DeliveryNoteLineSchema).min(1, 'Minimal 1 baris rincian').optional(),
});

export const DeliveryNoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const DeliveryNoteLineResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.string(),
});

export const DeliveryNoteResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  salesOrderId: z.string().uuid().nullable(),
  salesOrderReference: z.string().nullable(),
  salesInvoiceId: z.string().uuid().nullable(),
  salesInvoiceReference: z.string().nullable(),
  deliveryDate: z.string(),
  reference: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  description: z.string().nullable(),
  lines: z.array(DeliveryNoteLineResponseSchema),
});

export const DeliveryNoteSingleResponseSchema = z.object({ data: DeliveryNoteResponseSchema });
export const DeliveryNoteParamsSchema = z.object({
  businessId: z.string().uuid(),
  deliveryNoteId: z.string().uuid(),
});