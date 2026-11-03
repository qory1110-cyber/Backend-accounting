import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const LatePaymentFeeCreateSchema = z.object({
  customerId: z.string().uuid(),
  salesInvoiceId: z.string().uuid(),
  feeDate: IsoDateSchema,
  amount: z.coerce.number().positive(),
});

export const LatePaymentFeeUpdateSchema = LatePaymentFeeCreateSchema.partial();

export const LatePaymentFeeListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const LatePaymentFeeResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  salesInvoiceId: z.string().uuid(),
  salesInvoiceReference: z.string().nullable(),
  salesInvoiceDate: z.string(),
  feeDate: z.string(),
  amount: z.number(),
});

export const LatePaymentFeeSingleResponseSchema = z.object({ data: LatePaymentFeeResponseSchema });
export const LatePaymentFeeParamsSchema = z.object({
  businessId: z.string().uuid(),
  latePaymentFeeId: z.string().uuid(),
});