import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import {
  creditNotes,
  creditNoteLines,
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

type LineInput = { accountId: string; qty: number; unitPrice: number };

async function findArControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '1200')))
    .limit(1);
  return row ?? null;
}

// Customer harus is_customer, aktif, dan milik bisnis ini.
async function isValidCustomer(businessId: string, customerId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, customerId),
        eq(contacts.businessId, businessId),
        eq(contacts.isCustomer, true),
        eq(contacts.isActive, true),
      ),
    )
    .limit(1);
  return !!row;
}

// Semua akun baris harus milik bisnis ini dan berkategori Income.
async function areValidIncomeAccounts(businessId: string, accountIds: string[]) {
  const unique = [...new Set(accountIds)];
  const rows = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        inArray(chartOfAccounts.id, unique),
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.category, 'Income'),
      ),
    );
  return rows.length === unique.length;
}

async function attachComputedFields(note: typeof creditNotes.$inferSelect) {
  const lines = await db
    .select({
      id: creditNoteLines.id,
      accountId: creditNoteLines.accountId,
      accountName: chartOfAccounts.name,
      qty: creditNoteLines.qty,
      unitPrice: creditNoteLines.unitPrice,
    })
    .from(creditNoteLines)
    .innerJoin(chartOfAccounts, eq(creditNoteLines.accountId, chartOfAccounts.id))
    .where(eq(creditNoteLines.creditNoteId, note.id))
    .orderBy(creditNoteLines.lineNo);

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const [customer] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, note.customerId))
    .limit(1);

  return {
    ...note,
    customerName: customer?.name ?? '',
    lines: linesOut,
    totalAmount,
  };
}

export async function listCreditNotes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(creditNotes.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(creditNotes.issueDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(creditNotes.issueDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(creditNotes.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(creditNotes)
    .innerJoin(contacts, eq(creditNotes.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(creditNotes))
    .from(creditNotes)
    .innerJoin(contacts, eq(creditNotes.customerId, contacts.id))
    .where(where)
    .orderBy(desc(creditNotes.issueDate), desc(creditNotes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getCreditNoteById(businessId: string, creditNoteId: string) {
  const [row] = await db
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.id, creditNoteId), eq(creditNotes.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

// Posting jurnal saat dibuat: Debit akun Income (per akun), Kredit Piutang Usaha pelanggan.
export async function createCreditNote(
  businessId: string,
  data: {
    customerId: string;
    issueDate: string;
    reference?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }
  if (!(await areValidIncomeAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  const totalAmount = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  if (totalAmount <= 0) return { result: null, error: 'ZERO_TOTAL' as const };

  const arAccount = await findArControlAccount(businessId);
  if (!arAccount) return { result: null, error: 'NO_AR_ACCOUNT' as const };

  const lockedUntil = await findLockedUntil(businessId, [], header.issueDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  // ID dibuat di awal supaya jurnal bisa menyimpan sourceId sebelum Credit Note-nya ada.
  const creditNoteId = randomUUID();

  await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: header.issueDate,
        sourceModule: 'credit_note',
        sourceId: creditNoteId,
        description: header.reference ?? 'Credit Note',
      })
      .returning();

    // Debit: akun Income, digabung per akun.
    const grouped = new Map<string, number>();
    for (const l of lines) {
      grouped.set(l.accountId, (grouped.get(l.accountId) ?? 0) + l.qty * l.unitPrice);
    }
    for (const [accountId, amount] of grouped) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journalEntry.id,
        accountId,
        debit: amount.toFixed(2),
        credit: '0.00',
      });
    }

    // Kredit: Piutang Usaha atas nama pelanggan.
    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: arAccount.id,
      contactId: header.customerId,
      debit: '0.00',
      credit: totalAmount.toFixed(2),
    });

    await tx.insert(creditNotes).values({
      id: creditNoteId,
      businessId,
      ...header,
      journalEntryId: journalEntry.id,
    } as typeof creditNotes.$inferInsert);

    await tx.insert(creditNoteLines).values(
      lines.map((l, i) => ({
        creditNoteId,
        lineNo: i,
        accountId: l.accountId,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
  });

  return { result: await getCreditNoteById(businessId, creditNoteId), error: null };
}

// Hapus: posting JURNAL PEMBALIK (bukan hapus jurnal asli), lalu hapus Credit Note.
export async function deleteCreditNote(businessId: string, creditNoteId: string) {
  const note = await getCreditNoteById(businessId, creditNoteId);
  if (!note) return { deleted: false, lockedUntil: null };

  const lockedUntil = await findLockedUntil(businessId, [], note.issueDate);
  if (lockedUntil) return { deleted: false, lockedUntil };

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, note.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceModule: 'credit_note_void',
        sourceId: note.id,
        description: `Pembalik Credit Note ${note.reference ?? note.id}`,
      })
      .returning();

    for (const line of originalLines) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        contactId: line.contactId,
        projectId: line.projectId,
        debit: line.credit,
        credit: line.debit,
      });
    }

    await tx.delete(creditNotes).where(eq(creditNotes.id, creditNoteId));
  });

  return { deleted: true, lockedUntil: null };
}