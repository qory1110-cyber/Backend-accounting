import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import {
  billableTimes,
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
  salesInvoices,
  salesInvoiceLines,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Tiga akun sistem, dibuat otomatis per bisnis saat Billable Time pertama dibuat.
const ACCOUNT_DEFS = {
  asset: { code: '1290', name: 'Billable time', category: 'Asset' as const },
  movement: { code: '4910', name: 'Billable time - movement', category: 'Income' as const },
  invoiced: { code: '4920', name: 'Billable time - invoiced', category: 'Income' as const },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const computeAmount = (rate: number, hours: number, minutes: number) => round2(rate * (hours + minutes / 60));
const today = () => new Date().toISOString().slice(0, 10);

// Semua hasil fungsi repository memakai bentuk yang sama supaya route mudah memetakan error.
function fail<E extends string>(error: E, lockedUntil: string | null = null) {
  return { result: null, error, lockedUntil };
}

async function ensureAccount(tx: Tx, businessId: string, def: { code: string; name: string; category: 'Asset' | 'Income' }) {
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
    asset: await ensureAccount(tx, businessId, ACCOUNT_DEFS.asset),
    movement: await ensureAccount(tx, businessId, ACCOUNT_DEFS.movement),
    invoiced: await ensureAccount(tx, businessId, ACCOUNT_DEFS.invoiced),
  };
}

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

// Jurnal pembentukan aset: Debit Billable time (per pelanggan), Kredit Billable time - movement.
async function postJournal(
  tx: Tx,
  businessId: string,
  billableTimeId: string,
  workDate: string,
  customerId: string | null,
  amount: number,
  accounts: Awaited<ReturnType<typeof ensureAccounts>>,
) {
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      businessId,
      entryDate: workDate,
      sourceModule: 'billable_time',
      sourceId: billableTimeId,
      description: 'Billable Time',
    })
    .returning();

  await tx.insert(journalEntryLines).values([
    { journalEntryId: entry.id, accountId: accounts.asset.id, contactId: customerId, debit: amount.toFixed(2), credit: '0.00' },
    { journalEntryId: entry.id, accountId: accounts.movement.id, debit: '0.00', credit: amount.toFixed(2) },
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

const baseColumns = () => ({ ...getTableColumns(billableTimes), customerName: contacts.name });
type Row = typeof billableTimes.$inferSelect & { customerName: string | null };

function toOutput(row: Row) {
  const hourlyRate = Number(row.hourlyRate);
  return { ...row, hourlyRate, amount: computeAmount(hourlyRate, row.hours, row.minutes) };
}

export async function listBillableTimes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; status?: 'uninvoiced' | 'invoiced' | 'written_off'; customerId?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(billableTimes.businessId, businessId)];
  if (filters.status) conds.push(eq(billableTimes.status, filters.status));
  if (filters.customerId) conds.push(eq(billableTimes.customerId, filters.customerId));
  if (filters.dateFrom) conds.push(gte(billableTimes.workDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(billableTimes.workDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(billableTimes.description, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(billableTimes)
    .leftJoin(contacts, eq(billableTimes.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(baseColumns())
    .from(billableTimes)
    .leftJoin(contacts, eq(billableTimes.customerId, contacts.id))
    .where(where)
    .orderBy(desc(billableTimes.workDate), desc(billableTimes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(toOutput), total: Number(count) };
}

export async function getBillableTimeById(businessId: string, billableTimeId: string) {
  const [row] = await db
    .select(baseColumns())
    .from(billableTimes)
    .leftJoin(contacts, eq(billableTimes.customerId, contacts.id))
    .where(and(eq(billableTimes.id, billableTimeId), eq(billableTimes.businessId, businessId)))
    .limit(1);
  return row ? toOutput(row) : null;
}

export async function createBillableTime(
  businessId: string,
  data: {
    customerId?: string;
    workDate: string;
    description?: string;
    hourlyRate: number;
    hours: number;
    minutes: number;
  },
) {
  if (data.customerId && !(await isValidCustomer(businessId, data.customerId))) {
    return fail('INVALID_CUSTOMER');
  }

  const amount = computeAmount(data.hourlyRate, data.hours, data.minutes);

  const lockedUntil = await findLockedUntil(businessId, [], data.workDate);
  if (lockedUntil) return fail('PERIOD_LOCKED', lockedUntil);

  // ID dibuat di awal supaya jurnal bisa menyimpan sourceId.
  const id = randomUUID();

  await db.transaction(async (tx) => {
    let journalEntryId: string | null = null;
    if (amount > 0) {
      const accounts = await ensureAccounts(tx, businessId);
      journalEntryId = await postJournal(tx, businessId, id, data.workDate, data.customerId ?? null, amount, accounts);
    }

    await tx.insert(billableTimes).values({
      id,
      businessId,
      customerId: data.customerId ?? null,
      workDate: data.workDate,
      description: data.description ?? null,
      hourlyRate: data.hourlyRate.toFixed(2),
      hours: data.hours,
      minutes: data.minutes,
      journalEntryId,
    });
  });

  return { result: await getBillableTimeById(businessId, id), error: null, lockedUntil: null };
}

// Edit hanya untuk catatan Uninvoiced. Bila angka berubah, jurnal lama dibalik lalu jurnal baru diposting.
// status 'written_off' menghapuskan catatan (jurnal pembalik pada tanggal penghapusan).
export async function updateBillableTime(
  businessId: string,
  billableTimeId: string,
  data: Partial<{
    customerId: string | null;
    workDate: string;
    description: string | null;
    hourlyRate: number;
    hours: number;
    minutes: number;
    status: 'written_off';
    writtenOffDate: string;
  }>,
) {
  const [existing] = await db
    .select()
    .from(billableTimes)
    .where(and(eq(billableTimes.id, billableTimeId), eq(billableTimes.businessId, businessId)))
    .limit(1);
  if (!existing) return fail('NOT_FOUND');
  if (existing.status !== 'uninvoiced') return fail('NOT_EDITABLE');

  const { status, writtenOffDate, ...fields } = data;

  if (fields.customerId && !(await isValidCustomer(businessId, fields.customerId))) {
    return fail('INVALID_CUSTOMER');
  }

  const next = {
    customerId: fields.customerId !== undefined ? fields.customerId : existing.customerId,
    workDate: fields.workDate ?? existing.workDate,
    hourlyRate: fields.hourlyRate ?? Number(existing.hourlyRate),
    hours: fields.hours ?? existing.hours,
    minutes: fields.minutes ?? existing.minutes,
  };
  const financialChanged =
    next.customerId !== existing.customerId ||
    next.workDate !== existing.workDate ||
    next.hourlyRate !== Number(existing.hourlyRate) ||
    next.hours !== existing.hours ||
    next.minutes !== existing.minutes;
  const writeOffDate = status === 'written_off' ? (writtenOffDate ?? today()) : null;

  const datesToCheck = new Set<string>();
  if (financialChanged) {
    if (existing.journalEntryId) datesToCheck.add(existing.workDate);
    datesToCheck.add(next.workDate);
  }
  if (writeOffDate) datesToCheck.add(writeOffDate);
  for (const d of datesToCheck) {
    const lockedUntil = await findLockedUntil(businessId, [], d);
    if (lockedUntil) return fail('PERIOD_LOCKED', lockedUntil);
  }

  await db.transaction(async (tx) => {
    let journalEntryId = existing.journalEntryId;

    if (financialChanged) {
      if (journalEntryId) {
        await reverseJournal(tx, businessId, journalEntryId, existing.workDate, 'billable_time_edit_void', billableTimeId, 'Pembalik Billable Time (diubah)');
        journalEntryId = null;
      }
      const newAmount = computeAmount(next.hourlyRate, next.hours, next.minutes);
      if (newAmount > 0) {
        const accounts = await ensureAccounts(tx, businessId);
        journalEntryId = await postJournal(tx, businessId, billableTimeId, next.workDate, next.customerId, newAmount, accounts);
      }
    }

    await tx
      .update(billableTimes)
      .set({
        customerId: next.customerId,
        workDate: next.workDate,
        description: fields.description !== undefined ? fields.description : existing.description,
        hourlyRate: next.hourlyRate.toFixed(2),
        hours: next.hours,
        minutes: next.minutes,
        journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(billableTimes.id, billableTimeId));

    if (writeOffDate) {
      if (journalEntryId) {
        await reverseJournal(tx, businessId, journalEntryId, writeOffDate, 'billable_time_writeoff', billableTimeId, 'Written-off Billable Time');
      }
      await tx
        .update(billableTimes)
        .set({ status: 'written_off', writtenOffDate: writeOffDate })
        .where(eq(billableTimes.id, billableTimeId));
    }
  });

  return { result: await getBillableTimeById(businessId, billableTimeId), error: null, lockedUntil: null };
}

// Hapus: catatan Invoiced tidak boleh dihapus. Catatan Uninvoiced dihapus dengan jurnal pembalik.
export async function deleteBillableTime(businessId: string, billableTimeId: string) {
  const [existing] = await db
    .select()
    .from(billableTimes)
    .where(and(eq(billableTimes.id, billableTimeId), eq(billableTimes.businessId, businessId)))
    .limit(1);
  if (!existing) return { deleted: false, error: 'NOT_FOUND' as const, lockedUntil: null as string | null };
  if (existing.status === 'invoiced') return { deleted: false, error: 'ALREADY_INVOICED' as const, lockedUntil: null as string | null };

  const needsReversal = existing.status === 'uninvoiced' && !!existing.journalEntryId;
  if (needsReversal) {
    const lockedUntil = await findLockedUntil(businessId, [], existing.workDate);
    if (lockedUntil) return { deleted: false, error: 'PERIOD_LOCKED' as const, lockedUntil };
  }

  await db.transaction(async (tx) => {
    if (needsReversal && existing.journalEntryId) {
      await reverseJournal(tx, businessId, existing.journalEntryId, existing.workDate, 'billable_time_void', existing.id, 'Pembalik Billable Time (dihapus)');
    }
    await tx.delete(billableTimes).where(eq(billableTimes.id, billableTimeId));
  });

  return { deleted: true, error: null, lockedUntil: null as string | null };
}

// Penagihan: buat Sales Invoice (status 'sent') dari catatan Uninvoiced milik satu pelanggan.
// Jurnal faktur: Debit Piutang Usaha, Kredit Billable time - invoiced.
// Setiap catatan: jurnal pembalik (Kredit Billable time, Debit movement) lalu status jadi 'invoiced'.
export async function invoiceBillableTimes(
  businessId: string,
  data: { customerId: string; billableTimeIds: string[] },
) {
  const [customer] = await db
    .select({ id: contacts.id, billingAddress: contacts.billingAddress })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, data.customerId),
        eq(contacts.businessId, businessId),
        eq(contacts.isCustomer, true),
        eq(contacts.isActive, true),
      ),
    )
    .limit(1);
  if (!customer) return fail('INVALID_CUSTOMER');

  const uniqueIds = [...new Set(data.billableTimeIds)];
  const items = await db
    .select()
    .from(billableTimes)
    .where(and(eq(billableTimes.businessId, businessId), inArray(billableTimes.id, uniqueIds)));

  if (items.length !== uniqueIds.length) return fail('ITEM_NOT_FOUND');
  if (items.some((i) => i.customerId !== data.customerId)) return fail('CUSTOMER_MISMATCH');
  if (items.some((i) => i.status !== 'uninvoiced')) return fail('NOT_UNINVOICED');

  const lines = items.map((i) => {
    const qty = round2(i.hours + i.minutes / 60);
    const unitPrice = Number(i.hourlyRate);
    return { item: i, qty, unitPrice, subtotal: round2(qty * unitPrice) };
  });
  const invoiceAmount = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
  if (invoiceAmount <= 0) return fail('ZERO_TOTAL');

  const arAccount = await findArControlAccount(businessId);
  if (!arAccount) return fail('NO_AR_ACCOUNT');

  const issueDate = today();
  const lockedUntil = await findLockedUntil(businessId, [], issueDate);
  if (lockedUntil) return fail('PERIOD_LOCKED', lockedUntil);

  const salesInvoiceId = await db.transaction(async (tx) => {
    const accounts = await ensureAccounts(tx, businessId);

    const [invoice] = await tx
      .insert(salesInvoices)
      .values({
        businessId,
        customerId: data.customerId,
        issueDate,
        dueDate: issueDate,
        billingAddress: customer.billingAddress,
        status: 'sent',
      })
      .returning();

    await tx.insert(salesInvoiceLines).values(
      lines.map((l) => ({
        salesInvoiceId: invoice.id,
        accountId: accounts.invoiced.id,
        qty: l.qty.toFixed(2),
        unitPrice: l.unitPrice.toFixed(2),
      })),
    );

    const [entry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: issueDate,
        sourceModule: 'sales_invoice',
        sourceId: invoice.id,
        description: 'Faktur Penjualan - Billable Time',
      })
      .returning();

    await tx.insert(journalEntryLines).values([
      { journalEntryId: entry.id, accountId: arAccount.id, contactId: data.customerId, debit: invoiceAmount.toFixed(2), credit: '0.00' },
      { journalEntryId: entry.id, accountId: accounts.invoiced.id, debit: '0.00', credit: invoiceAmount.toFixed(2) },
    ]);

    await tx.update(salesInvoices).set({ journalEntryId: entry.id }).where(eq(salesInvoices.id, invoice.id));

    for (const { item } of lines) {
      if (item.journalEntryId) {
        await reverseJournal(tx, businessId, item.journalEntryId, issueDate, 'billable_time_invoiced', item.id, 'Billable Time ditagihkan');
      }
      await tx
        .update(billableTimes)
        .set({ status: 'invoiced', salesInvoiceId: invoice.id, updatedAt: new Date() })
        .where(eq(billableTimes.id, item.id));
    }

    return invoice.id;
  });

  return {
    result: { salesInvoiceId, invoiceAmount, billableTimeCount: lines.length },
    error: null,
    lockedUntil: null as string | null,
  };
}