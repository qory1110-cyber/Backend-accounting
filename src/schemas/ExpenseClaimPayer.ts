import { z } from 'zod';

export const ExpenseClaimPayerCreateSchema = z.object({
  name: z.string().trim().min(1).max(225),
});

export const ExpenseClaimPayerUpdateSchema = ExpenseClaimPayerCreateSchema;

export const ExpenseClaimPayerToggleActiveSchema = z.object({
  isActive: z.boolean(),
});

export const ExpenseClaimPayerResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  contactId: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

export const ExpenseClaimPayerListResponseSchema = z.object({
  data: z.array(ExpenseClaimPayerResponseSchema),
});

export const ExpenseClaimPayerSingleResponseSchema = z.object({
  data: ExpenseClaimPayerResponseSchema,
});

export const ExpenseClaimPayerParamsSchema = z.object({
  businessId: z.string().uuid(),
  payerId: z.string().uuid(),
});