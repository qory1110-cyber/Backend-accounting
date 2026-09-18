import { z } from 'zod';

export const AccountCategorySchema = z.enum(['Asset', 'Liability', 'Equity', 'Income', 'Expense']);

export const ChartOfAccountCreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(225),
  category: AccountCategorySchema,
  groupName: z.string().max(100).optional(),
  currencyCode: z.string().length(3).default('IDR'),
  isControlAccount: z.boolean().default(false),
});

export const ChartOfAccountUpdateSchema = ChartOfAccountCreateSchema.partial();

export const ChartOfAccountResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  category: AccountCategorySchema,
  groupName: z.string().nullable(),
  currencyCode: z.string(),
  isControlAccount: z.boolean(),
  isActive: z.boolean(), // <- baru
});

export const ChartOfAccountListQuerySchema = z.object({
  category: AccountCategorySchema.optional(),
});

export const ChartOfAccountListResponseSchema = z.object({
  data: z.array(ChartOfAccountResponseSchema),
});

export const ChartOfAccountSingleResponseSchema = z.object({
  data: ChartOfAccountResponseSchema,
});

export const ChartOfAccountParamsSchema = z.object({
  businessId: z.string().uuid(),
  accountId: z.string().uuid(),
});

export const ChartOfAccountToggleActiveSchema = z.object({
  isActive: z.boolean(),
});