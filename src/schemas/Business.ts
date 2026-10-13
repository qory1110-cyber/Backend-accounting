import { z } from 'zod';
import { createSingleResponseSchema, IsoDateSchema } from './globals.js';

export const BusinessRoleSchema = z.enum(['admin', 'accountant', 'viewer']);

// Modul yang boleh disembunyikan lewat Customize - sengaja TIDAK termasuk
// Chart of Accounts (dipakai dropdown akun di banyak tempat) dan Members
// (soal kontrol akses, bukan modul data).
export const HideableModuleSchema = z.enum([
  'customers',
  'suppliers',
  'bank-accounts',
  'sales-invoices',
  'purchase-invoices',
  'receipts',
  'payments',
  'inter-account-transfers',
]);

export const BusinessCreateSchema = z.object({
  name: z.string().min(1),
  baseCurrencyCode: z.string().length(3).default('IDR'),
});

export const BusinessUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  baseCurrencyCode: z.string().length(3).optional(),
  hiddenModules: z.array(HideableModuleSchema).optional(),
});

export const BusinessLockDateBodySchema = z.object({
  lockDate: IsoDateSchema.nullable(),
});

export const BusinessResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  baseCurrencyCode: z.string(),
  role: BusinessRoleSchema.optional(),
  hiddenModules: z.array(z.string()),
  lockDate: z.string().nullable(),
});

export const BusinessListResponseSchema = z.object({
  data: z.array(BusinessResponseSchema),
});

export const BusinessSingleResponseSchema = createSingleResponseSchema(BusinessResponseSchema);

export const BusinessParamsSchema = z.object({
  businessId: z.string().uuid(),
});

export const MemberInviteBodySchema = z.object({
  email: z.string().email(),
  role: BusinessRoleSchema,
});

export const MemberRoleUpdateBodySchema = z.object({
  role: BusinessRoleSchema,
});

export const MemberParamsSchema = z.object({
  businessId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const MemberResponseSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: BusinessRoleSchema,
  status: z.string(),
});

export const MemberListResponseSchema = z.object({
  data: z.array(MemberResponseSchema),
});

export const BusinessDeleteBodySchema = z.object({
  confirmName: z.string().min(1),
});