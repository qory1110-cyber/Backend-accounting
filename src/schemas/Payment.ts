import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema, createPaginatedResponseSchema } from './globals.js';

export const PaymentLineSchema = z.object({
  amount: z.coerce.number().positive(),
  // Isi purchaseInvoiceId untuk melunasi faktur (accountId diabaikan, dipaksa
  // ke Utang Usaha). Kosongkan dan isi accountId untuk posting langsung ke GL.
    purchaseInvoiceId: z.string().uuid().optional(),
  // Isi expenseClaimId untuk melunasi klaim biaya (accountId diabaikan, dipaksa
  // ke Utang Klaim Biaya). Payee harus Payer pemilik klaim.
  expenseClaimId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
})
  .refine((l) => l.purchaseInvoiceId || l.expenseClaimId || l.accountId, {
    message: 'Isi purchaseInvoiceId, expenseClaimId, atau accountId',
  })
  .refine((l) => !(l.purchaseInvoiceId && l.expenseClaimId), {
    message: 'Satu baris tidak boleh melunasi faktur dan klaim sekaligus',
  });

export const PaymentCreateSchema = z.object({
  paymentDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  paidFromBankAccountId: z.string().uuid(),
  payeeContactId: z.string().uuid(),
  description: z.string().optional(),
  lines: z.array(PaymentLineSchema).min(1, 'Minimal 1 baris rincian'),
});

export const PaymentLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  purchaseInvoiceId: z.string().uuid().nullable(),
  purchaseInvoiceReference: z.string().nullable(),
  expenseClaimId: z.string().uuid().nullable(),
  expenseClaimReference: z.string().nullable(),
  amount: z.string(),
});

export const PaymentResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  paymentDate: z.string(),
  reference: z.string(),
  paidFromBankAccountId: z.string().uuid(),
  paidFromBankAccountName: z.string(),
  payeeContactId: z.string().uuid(),
  payeeContactName: z.string(),
  description: z.string().nullable(),
  cleared: z.boolean(),
  lines: z.array(PaymentLineResponseSchema),
  totalAmount: z.number(),
});

export const PaymentListResponseSchema = createPaginatedResponseSchema(PaymentResponseSchema);
export const PaymentSingleResponseSchema = z.object({ data: PaymentResponseSchema });
export const PaymentParamsSchema = z.object({
  businessId: z.string().uuid(),
  paymentId: z.string().uuid(),
});
export const PaymentListQuerySchema = PaginationQuerySchema;

export const PaymentTotalsResponseSchema = z.object({
  data: z.object({ totalAmount: z.number() }),
});

export const SetPaymentClearedSchema = z.object({ cleared: z.boolean() });