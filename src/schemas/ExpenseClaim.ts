import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema, createPaginatedResponseSchema } from './globals.js';

export const ExpenseClaimLineInputSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().optional(),
  amount: z.coerce.number().positive(),
});

export const ExpenseClaimCreateSchema = z.object({
  claimDate: IsoDateSchema,
  reference: z.string().max(100).optional(),
  payerId: z.string().uuid(),
  payee: z.string().max(225).optional(),
  description: z.string().optional(),
  lines: z.array(ExpenseClaimLineInputSchema).min(1),
});

export const ExpenseClaimListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  payerId: z.string().uuid().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const ExpenseClaimLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  description: z.string().nullable(),
  amount: z.number(),
});

export const ExpenseClaimResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  claimDate: z.string(),
  reference: z.string().nullable(),
  payerId: z.string().uuid(),
  payerName: z.string(),
  payee: z.string().nullable(),
  description: z.string().nullable(),
  totalAmount: z.number(),
  paidAmount: z.number(),
  balanceDue: z.number(),
  status: z.enum(['Unpaid', 'Paid']),
  createdAt: z.string(),
  lines: z.array(ExpenseClaimLineResponseSchema),
});

export const ExpenseClaimSingleResponseSchema = z.object({
  data: ExpenseClaimResponseSchema,
});

export const ExpenseClaimListResponseSchema = createPaginatedResponseSchema(ExpenseClaimResponseSchema);

export const ExpenseClaimParamsSchema = z.object({
  businessId: z.string().uuid(),
  claimId: z.string().uuid(),
});