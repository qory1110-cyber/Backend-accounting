import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

export const ReceiptLineSchema = z.object({
  amount: z.coerce.number().positive(),
  // Isi salesInvoiceId untuk melunasi faktur (accountId diabaikan, dipaksa ke Piutang Usaha).
  // Kosongkan salesInvoiceId dan isi accountId untuk posting langsung ke GL.
  salesInvoiceId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  // Hanya dipakai untuk baris posting langsung ke GL; diabaikan kalau melunasi faktur.
  projectId: z.string().uuid().optional(),
}).refine((l) => l.salesInvoiceId || l.accountId, {
  message: 'Isi salesInvoiceId atau accountId',
});

export const ReceiptCreateSchema = z.object({
  receiptDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  receivedInBankAccountId: z.string().uuid(),
  paidByContactId: z.string().uuid().optional(),
  description: z.string().optional(),
  lines: z.array(ReceiptLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const ReceiptLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  salesInvoiceId: z.string().uuid().nullable(),
  salesInvoiceReference: z.string().nullable(),
  amount: z.string(),
});

export const ReceiptResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  receiptDate: z.string(),
  reference: z.string(),
  receivedInBankAccountId: z.string().uuid(),
  receivedInBankAccountName: z.string(),
  paidByContactId: z.string().uuid().nullable(),
  paidByContactName: z.string().nullable(),
  description: z.string().nullable(),
  cleared: z.boolean(),
  lines: z.array(ReceiptLineResponseSchema),
  totalAmount: z.number(),
});

export const ReceiptListResponseSchema = z.object({ data: z.array(ReceiptResponseSchema) });
export const ReceiptSingleResponseSchema = z.object({ data: ReceiptResponseSchema });
export const ReceiptParamsSchema = z.object({
  businessId: z.string().uuid(),
  receiptId: z.string().uuid(),
});

export const ReceiptTotalsResponseSchema = z.object({
  data: z.object({
    totalAmount: z.number(),
  }),
});

export const SetReceiptClearedSchema = z.object({ cleared: z.boolean() });