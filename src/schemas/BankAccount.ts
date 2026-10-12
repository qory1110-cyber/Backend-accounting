import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

export const BankAccountCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().max(50).optional(),
  controlAccountId: z.string().uuid(),
  accountNumber: z.string().max(50).optional(),
  openingBalance: z.coerce.number().optional(),
  openingBalanceDate: IsoDateSchema.optional(),
  canHavePendingTransactions: z.boolean().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
});

export const BankAccountUpdateSchema = BankAccountCreateSchema.partial();

export const BankAccountToggleActiveSchema = z.object({
  isActive: z.boolean(),
});

export const BankAccountResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  controlAccountId: z.string().uuid(),
  controlAccountName: z.string(), // hasil join, biar frontend tidak perlu fetch terpisah
  currencyCode: z.string(), // diturunkan dari Control Account
  accountNumber: z.string().nullable(),
  openingBalance: z.string(),
  openingBalanceDate: z.string().nullable(),
  canHavePendingTransactions: z.boolean(),
  creditLimit: z.string(),
  isActive: z.boolean(),
  lockDate: z.string().nullable(),
  // Dihitung sungguhan dari journal_entry_lines (BUKAN hardcode) - lihat repository.
  actualBalance: z.number(),
  // Butuh modul Payments (status Cleared) & Bank Reconciliations - belum ada.
  pendingWithdrawals: z.number(),
  pendingDeposits: z.number(),
  lastReconciliationDate: z.string().nullable(),
});

export const BankAccountListResponseSchema = z.object({
  data: z.array(BankAccountResponseSchema),
});

export const BankAccountSingleResponseSchema = z.object({
  data: BankAccountResponseSchema,
});

export const BankAccountParamsSchema = z.object({
  businessId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
});

export const RecentBankAccountResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
    isActive: z.boolean(),
  })),
});

export const RecentBankAccountQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const BankAccountLockDateSchema = z.object({
  lockDate: IsoDateSchema.nullable(),
});