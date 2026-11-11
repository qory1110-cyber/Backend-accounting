import { z } from 'zod';
import { IsoDateSchema, PaginationQuerySchema } from './globals.js';

export const BillableTimeCreateSchema = z.object({
  customerId: z.string().uuid().optional(),
  workDate: IsoDateSchema,
  description: z.string().optional(),
  hourlyRate: z.coerce.number().min(0).default(0),
  hours: z.coerce.number().int().min(0).default(0),
  minutes: z.coerce.number().int().min(0).default(0),
});

// Update: field opsional boleh dikosongkan dengan mengirim null.
// status hanya boleh 'written_off' (status Invoiced diisi otomatis oleh penagihan).
export const BillableTimeUpdateSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  workDate: IsoDateSchema.optional(),
  description: z.string().nullable().optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  hours: z.coerce.number().int().min(0).optional(),
  minutes: z.coerce.number().int().min(0).optional(),
  status: z.literal('written_off').optional(),
  writtenOffDate: IsoDateSchema.optional(),
});

export const BillableTimeListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  status: z.enum(['uninvoiced', 'invoiced', 'written_off']).optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const BillableTimeResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  workDate: z.string(),
  description: z.string().nullable(),
  hourlyRate: z.number(),
  hours: z.number(),
  minutes: z.number(),
  amount: z.number(),
  status: z.enum(['uninvoiced', 'invoiced', 'written_off']),
  writtenOffDate: z.string().nullable(),
  salesInvoiceId: z.string().uuid().nullable(),
});

export const BillableTimeSingleResponseSchema = z.object({ data: BillableTimeResponseSchema });
export const BillableTimeParamsSchema = z.object({
  businessId: z.string().uuid(),
  billableTimeId: z.string().uuid(),
});

export const BillableTimeInvoiceBodySchema = z.object({
  customerId: z.string().uuid(),
  billableTimeIds: z.array(z.string().uuid()).min(1, 'Pilih minimal 1 catatan'),
});

export const BillableTimeInvoiceResponseSchema = z.object({
  data: z.object({
    salesInvoiceId: z.string().uuid(),
    invoiceAmount: z.number(),
    billableTimeCount: z.number(),
  }),
});