import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

export const BankReconciliationCreateSchema = z.object({
  bankAccountId: z.string().uuid(),
  reconciliationDate: IsoDateSchema,
  statementBalance: z.coerce.number(),
});

// Bank account sengaja tidak bisa diubah.
export const BankReconciliationUpdateSchema = z.object({
  reconciliationDate: IsoDateSchema.optional(),
  statementBalance: z.coerce.number().optional(),
});

const StatusSchema = z.enum(['reconciled', 'not_reconciled']);

export const BankReconciliationResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  bankAccountName: z.string(),
  reconciliationDate: z.string(),
  statementBalance: z.number(),
  bookBalance: z.number(),
  unclearedWithdrawals: z.number(),
  unclearedDeposits: z.number(),
  discrepancy: z.number(),
  status: StatusSchema,
});

export const UnclearedTransactionSchema = z.object({
  type: z.enum(['payment', 'receipt', 'transfer_out', 'transfer_in']),
  id: z.string().uuid(),
  date: z.string(),
  reference: z.string(),
  amount: z.number(),
  kind: z.enum(['withdrawal', 'deposit']),
});

export const BankReconciliationDetailResponseSchema = BankReconciliationResponseSchema.extend({
  unclearedTransactions: z.array(UnclearedTransactionSchema),
});

export const BankReconciliationSingleResponseSchema = z.object({
  data: BankReconciliationDetailResponseSchema,
});

export const BankReconciliationParamsSchema = z.object({
  businessId: z.string().uuid(),
  reconciliationId: z.string().uuid(),
});