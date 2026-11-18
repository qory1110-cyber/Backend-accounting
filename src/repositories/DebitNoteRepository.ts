import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import {
  debitNotes,
  debitNoteLines,
  purchaseInvoices,
  purchaseInvoiceLines,
  paymentLines,
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

type LineInput = { accountId: string; qty: number; unitPrice: number };

async function findApControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '2000')))
    .limit(1);
  return row ?? null;
}

// Supplier harus is_supplier, aktif, dan milik bisnis ini.
async function isValidSupplier(businessId: string, supplierId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, supplierId),
        eq(contacts.businessId, businessId),
        eq(contacts.isSupplier, true),
        eq(contacts.isActive, true),
      ),
    )
    .limit(1);
  return !!row;
}

// Semua akun baris harus milik bisnis ini dan berkategori Expense.
async function areValidExpenseAccounts(businessId: string, accountIds: string[]) {
  const unique = [...new Set(accountIds)];
  const rows = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        inArray(chartOfAccounts.id, unique),
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.category, 'Expense'),
      ),
    );
  return rows.length === unique.length;
}

// Sisa tagihan faktur = jumlah faktur - Σ pembayaran - Σ Debit Note yang dikaitkan.
// excludeDebitNoteId dipakai saat menghitung "bagaimana sisa tagihan kalau Debit Note ini dihapus".
async function getInvoiceRemaining(businessId: string, purchaseInvoiceId: string, excludeDebitNoteId?: string) {
  const [invoice] = await db
    .select({ supplierId: purchaseInvoices.supplierId, status: purchaseInvoices.status })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
    .limit(1);
  if (!invoice) return null;

  const [amountRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchaseInvoiceLines.qty} * ${purchaseInvoiceLines.unitPrice}), 0)` })
    .from(purchaseInvoiceLines)
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoiceId));

  const [paidRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .where(eq(paymentLines.purchaseInvoiceId, purchaseInvoiceId));

  const dnConds: SQL[] = [eq(debitNotes.purchaseInvoiceId, purchaseInvoiceId)];
  if (excludeDebitNoteId) dnConds.push(ne(debitNotes.id, excludeDebitNoteId));
  const [dnRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${debitNoteLines.qty} * ${debitNoteLines.unitPrice}), 0)` })
    .from(debitNoteLines)
    .innerJoin(debitNotes, eq(debitNoteLines.debitNoteId, debitNotes.id))
    .where(and(...dnConds));

  return {
    supplierId: invoice.supplierId,
    status: invoice.status,
    remaining: Number(amountRow.total) - Number(paidRow.total) - Number(dnRow.total),
  };
}

async function attachComputedFields(note: typeof debitNotes.$inferSelect) {
  const lines = await db
    .select({
      id: debitNoteLines.id,
      accountId: debitNoteLines.accountId,
      accountName: chartOfAccounts.name,
      qty: debitNoteLines.qty,
      unitPrice: debitNoteLines.unitPrice,
    })
    .from(debitNoteLines)
    .innerJoin(chartOfAccounts, eq(debitNoteLines.accountId, chartOfAccounts.id))
    .where(eq(debitNoteLines.debitNoteId, note.id))
    .orderBy(debitNoteLines.lineNo);

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const [supplier] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, note.supplierId))
    .limit(1);

  let purchaseInvoiceReference: string | null = null;
  if (note.purchaseInvoiceId) {
    const [invoice] = await db
      .select({ reference: purchaseInvoices.reference })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.id, note.purchaseInvoiceId))
      .limit(1);
    purchaseInvoiceReference = invoice?.reference ?? null;
  }

  return {
    ...note,
    supplierName: supplier?.name ?? '',
    purchaseInvoiceReference,
    lines: linesOut,
    totalAmount,
  };
}

export async function listDebitNotes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(debitNotes.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(debitNotes.issueDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(debitNotes.issueDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(debitNotes.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(debitNotes)
    .innerJoin(contacts, eq(debitNotes.supplierId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(debitNotes))
    .from(debitNotes)
    .innerJoin(contacts, eq(debitNotes.supplierId, contacts.id))
    .where(where)
    .orderBy(desc(debitNotes.issueDate), desc(debitNotes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getDebitNoteById(businessId: string, debitNoteId: string) {
  const [row] = await db
    .select()
    .from(debitNotes)
    .where(and(eq(debitNotes.id, debitNoteId), eq(debitNotes.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

// Posting jurnal saat dibuat: Debit Utang Usaha atas nama supplier, Kredit akun Expense per baris.
export async function createDebitNote(
  businessId: string,
  data: {
    supplierId: string;
    purchaseInvoiceId?: string;
    issueDate: string;
    reference?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }
  if (!(await areValidExpenseAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  const totalAmount = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  if (totalAmount <= 0) return { result: null, error: 'ZERO_TOTAL' as const };

  // Kaitan ke faktur (opsional): faktur harus approved, pemasoknya sama, dan nilainya tidak melebihi sisa tagihan.
  if (header.purchaseInvoiceId) {
    const info = await getInvoiceRemaining(businessId, header.purchaseInvoiceId);
    if (!info || info.status !== 'approved') return { result: null, error: 'INVALID_INVOICE' as const };
    if (info.supplierId !== header.supplierId) return { result: null, error: 'INVOICE_SUPPLIER_MISMATCH' as const };
    if (totalAmount > info.remaining + 0.01) return { result: null, error: 'OVER_BALANCE' as const };
  }

  const apAccount = await findApControlAccount(businessId);
  if (!apAccount) return { result: null, error: 'NO_AP_ACCOUNT' as const };

  const lockedUntil = await findLockedUntil(businessId, [], header.issueDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  // ID dibuat di awal supaya jurnal bisa menyimpan sourceId sebelum Debit Note-nya ada.
  const debitNoteId = randomUUID();

  await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: header.issueDate,
        sourceModule: 'debit_note',
        sourceId: debitNoteId,
        description: header.reference ?? 'Debit Note',
      })
      .returning();

    // Debit: Utang Usaha atas nama supplier (mengurangi utang).
    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: apAccount.id,
      contactId: header.supplierId,
      debit: totalAmount.toFixed(2),
      credit: '0.00',
    });

    // Kredit: akun Expense, digabung per akun.
    const grouped = new Map<string, number>();
    for (const l of lines) {
      grouped.set(l.accountId, (grouped.get(l.accountId) ?? 0) + l.qty * l.unitPrice);
    }
    for (const [accountId, amount] of grouped) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journalEntry.id,
        accountId,
        debit: '0.00',
        credit: amount.toFixed(2),
      });
    }

    await tx.insert(debitNotes).values({
      id: debitNoteId,
      businessId,
      ...header,
      journalEntryId: journalEntry.id,
    } as typeof debitNotes.$inferInsert);

    await tx.insert(debitNoteLines).values(
      lines.map((l, i) => ({
        debitNoteId,
        lineNo: i,
        accountId: l.accountId,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
  });

  return { result: await getDebitNoteById(businessId, debitNoteId), error: null };
}

// Hapus: posting JURNAL PEMBALIK (bukan hapus jurnal asli), lalu hapus Debit Note.

export async function deleteDebitNote(businessId: string, debitNoteId: string) {
  const note = await getDebitNoteById(businessId, debitNoteId);
  if (!note) return { deleted: false, blocked: false, lockedUntil: null };

  const lockedUntil = await findLockedUntil(businessId, [], note.issueDate);
  if (lockedUntil) return { deleted: false, blocked: false, lockedUntil };

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
        sourceModule: 'debit_note_void',
        sourceId: note.id,
        description: `Pembalik Debit Note ${note.reference ?? note.id}`,
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

    await tx.delete(debitNotes).where(eq(debitNotes.id, debitNoteId));
  });

  return { deleted: true, blocked: false, lockedUntil: null };
}