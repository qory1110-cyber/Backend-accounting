import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import {
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
  withholdingTaxReceipts,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Dua akun sistem, dibuat otomatis per bisnis saat bukti potong pertama dibuat.
const ACCOUNT_DEFS = {
  tax: { code: '1291', name: 'Withholding tax', category: 'Asset' as const },
  receivable: { code: '1292', name: 'Withholding tax receivable', category: 'Asset' as const },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function fail<E extends string>(error: E, lockedUntil: string | null = null) {
  return { result: null, error, lockedUntil };
}

async function ensureAccount(tx: Tx, businessId: string, def: { code: string; name: string; category: 'Asset' }) {
  const [found] = await tx
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.name, def.name)))
    .limit(1);
  if (found) return found;
  const [created] = await tx
    .insert(chartOfAccounts)
    .values({ businessId, code: def.code, name: def.name, category: def.category })
    .returning();
  return created;
}

async function ensureAccounts(tx: Tx, businessId: string) {
  return {
    tax: await ensureAccount(tx, businessId, ACCOUNT_DEFS.tax),
    receivable: await ensureAccount(tx, businessId, ACCOUNT_DEFS.receivable),
  };
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

// Jurnal: Debit Withholding tax, Kredit Withholding tax receivable (per pelanggan).
async function postJournal(
  tx: Tx,
  businessId: string,
  receiptId: string,
  receiptDate: string,
  customerId: string,
  amount: number,
  accounts: Awaited<ReturnType<typeof ensureAccounts>>,
) {
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      businessId,
      entryDate: receiptDate,
      sourceModule: 'withholding_tax_receipt',
      sourceId: receiptId,
      description: 'Withholding Tax Receipt',
    })
    .returning();

  await tx.insert(journalEntryLines).values([
    { journalEntryId: entry.id, accountId: accounts.tax.id, debit: amount.toFixed(2), credit: '0.00' },
    { journalEntryId: entry.id, accountId: accounts.receivable.id, contactId: customerId, debit: '0.00', credit: amount.toFixed(2) },
  ]);
  return entry.id;
}

// Jurnal pembalik: salin baris jurnal asli dengan debit/kredit ditukar.
async function reverseJournal(
  tx: Tx,
  businessId: string,
  journalEntryId: string,
  entryDate: string,
  sourceModule: string,
  sourceId: string,
  description: string,
) {
  const originalLines = await tx
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, journalEntryId));

  const [reversal] = await tx
    .insert(journalEntries)
    .values({ businessId, entryDate, sourceModule, sourceId, description })
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
}

const baseColumns = () => ({ ...getTableColumns(withholdingTaxReceipts), customerName: contacts.name });
type Row = typeof withholdingTaxReceipts.$inferSelect & { customerName: string | null };

function toOutput(row: Row) {
  return { ...row, amount: Number(row.amount) };
}

export async function listWithholdingTaxReceipts(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; customerId?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(withholdingTaxReceipts.businessId, businessId)];
  if (filters.customerId) conds.push(eq(withholdingTaxReceipts.customerId, filters.customerId));
  if (filters.dateFrom) conds.push(gte(withholdingTaxReceipts.receiptDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(withholdingTaxReceipts.receiptDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(withholdingTaxReceipts.description, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count, total }] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${withholdingTaxReceipts.amount}), 0)`,
    })
    .from(withholdingTaxReceipts)
    .leftJoin(contacts, eq(withholdingTaxReceipts.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(baseColumns())
    .from(withholdingTaxReceipts)
    .leftJoin(contacts, eq(withholdingTaxReceipts.customerId, contacts.id))
    .where(where)
    .orderBy(desc(withholdingTaxReceipts.receiptDate), desc(withholdingTaxReceipts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(toOutput), total: Number(count), totalAmount: round2(Number(total)) };
}

export async function getWithholdingTaxReceiptById(businessId: string, receiptId: string) {
  const [row] = await db
    .select(baseColumns())
    .from(withholdingTaxReceipts)
    .leftJoin(contacts, eq(withholdingTaxReceipts.customerId, contacts.id))
    .where(and(eq(withholdingTaxReceipts.id, receiptId), eq(withholdingTaxReceipts.businessId, businessId)))
    .limit(1);
  return row ? toOutput(row) : null;
}

export async function createWithholdingTaxReceipt(
  businessId: string,
  data: { customerId: string; receiptDate: string; amount: number; description?: string },
) {
  if (!(await isValidCustomer(businessId, data.customerId))) return fail('INVALID_CUSTOMER');

  const amount = round2(data.amount);

  const lockedUntil = await findLockedUntil(businessId, [], data.receiptDate);
  if (lockedUntil) return fail('PERIOD_LOCKED', lockedUntil);

  // ID dibuat di awal supaya jurnal bisa menyimpan sourceId.
  const id = randomUUID();

  await db.transaction(async (tx) => {
    const accounts = await ensureAccounts(tx, businessId);
    const journalEntryId = await postJournal(tx, businessId, id, data.receiptDate, data.customerId, amount, accounts);

    await tx.insert(withholdingTaxReceipts).values({
      id,
      businessId,
      customerId: data.customerId,
      receiptDate: data.receiptDate,
      amount: amount.toFixed(2),
      description: data.description ?? null,
      journalEntryId,
    });
  });

  return { result: await getWithholdingTaxReceiptById(businessId, id), error: null, lockedUntil: null };
}

// Edit: bila customer/tanggal/jumlah berubah, jurnal lama dibalik lalu jurnal baru diposting.
export async function updateWithholdingTaxReceipt(
  businessId: string,
  receiptId: string,
  data: Partial<{ customerId: string; receiptDate: string; amount: number; description: string | null }>,
) {
  const [existing] = await db
    .select()
    .from(withholdingTaxReceipts)
    .where(and(eq(withholdingTaxReceipts.id, receiptId), eq(withholdingTaxReceipts.businessId, businessId)))
    .limit(1);
  if (!existing) return fail('NOT_FOUND');

  if (data.customerId && !(await isValidCustomer(businessId, data.customerId))) {
    return fail('INVALID_CUSTOMER');
  }

  const next = {
    customerId: data.customerId ?? existing.customerId,
    receiptDate: data.receiptDate ?? existing.receiptDate,
    amount: data.amount !== undefined ? round2(data.amount) : Number(existing.amount),
  };
  const financialChanged =
    next.customerId !== existing.customerId ||
    next.receiptDate !== existing.receiptDate ||
    next.amount !== Number(existing.amount);

  if (financialChanged) {
    for (const d of new Set([existing.receiptDate, next.receiptDate])) {
      const lockedUntil = await findLockedUntil(businessId, [], d);
      if (lockedUntil) return fail('PERIOD_LOCKED', lockedUntil);
    }
  }

  await db.transaction(async (tx) => {
    let journalEntryId = existing.journalEntryId;

    if (financialChanged) {
      if (journalEntryId) {
        await reverseJournal(
          tx,
          businessId,
          journalEntryId,
          existing.receiptDate,
          'withholding_tax_receipt_edit_void',
          receiptId,
          'Pembalik Withholding Tax Receipt (diubah)',
        );
      }
      const accounts = await ensureAccounts(tx, businessId);
      journalEntryId = await postJournal(tx, businessId, receiptId, next.receiptDate, next.customerId, next.amount, accounts);
    }

    await tx
      .update(withholdingTaxReceipts)
      .set({
        customerId: next.customerId,
        receiptDate: next.receiptDate,
        amount: next.amount.toFixed(2),
        description: data.description !== undefined ? data.description : existing.description,
        journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(withholdingTaxReceipts.id, receiptId));
  });

  return { result: await getWithholdingTaxReceiptById(businessId, receiptId), error: null, lockedUntil: null };
}

// Hapus: jurnal dibalik, lalu bukti potong dihapus.
export async function deleteWithholdingTaxReceipt(businessId: string, receiptId: string) {
  const [existing] = await db
    .select()
    .from(withholdingTaxReceipts)
    .where(and(eq(withholdingTaxReceipts.id, receiptId), eq(withholdingTaxReceipts.businessId, businessId)))
    .limit(1);
  if (!existing) return { deleted: false, error: 'NOT_FOUND' as const, lockedUntil: null as string | null };

  const lockedUntil = await findLockedUntil(businessId, [], existing.receiptDate);
  if (lockedUntil) return { deleted: false, error: 'PERIOD_LOCKED' as const, lockedUntil };

  await db.transaction(async (tx) => {
    if (existing.journalEntryId) {
      await reverseJournal(
        tx,
        businessId,
        existing.journalEntryId,
        existing.receiptDate,
        'withholding_tax_receipt_void',
        existing.id,
        'Pembalik Withholding Tax Receipt (dihapus)',
      );
    }
    await tx.delete(withholdingTaxReceipts).where(eq(withholdingTaxReceipts.id, receiptId));
  });

  return { deleted: true, error: null, lockedUntil: null as string | null };
}