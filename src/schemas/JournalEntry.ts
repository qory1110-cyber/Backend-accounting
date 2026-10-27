import { z } from 'zod';
import { IsoDateSchema } from './globals.js';

const JournalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  projectId: z.string().uuid().optional(),
  description: z.string().trim().max(500).optional(),
});

export const JournalEntryCreateSchema = z.object({
  entryDate: IsoDateSchema,
  reference: z.string().trim().max(100).optional(),
  description: z.string().trim().optional(),
  lines: z.array(JournalLineInputSchema).min(2, 'Minimal 2 baris'),
});

export const JournalEntryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
});

export const JournalLineResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  debit: z.number(),
  credit: z.number(),
  description: z.string().nullable(),
});

export const JournalEntryResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  entryDate: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(JournalLineResponseSchema),
  totalDebit: z.number(),
  totalCredit: z.number(),
});

export const JournalEntrySingleResponseSchema = z.object({
  data: JournalEntryResponseSchema,
});

export const JournalEntryParamsSchema = z.object({
  businessId: z.string().uuid(),
  journalEntryId: z.string().uuid(),
});