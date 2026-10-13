import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  purchaseInvoices,
  paymentLines,
  purchaseInvoiceLines,
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

export class BusinessError extends Error {}

type LineInput = { accountId: string; qty: number; unitPrice: number };

async function findApControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '2000')))
    .limit(1);
  return row ?? null;
}

// Validasi di backend (bukan cuma frontend): pemasok harus is_supplier & milik bisnis ini.
async function isValidSupplier(businessId: string, supplierId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, supplierId), eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
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

async function attachComputedFields(invoice: typeof purchaseInvoices.$inferSelect) {
  const lines = await db
    .select({
      id: purchaseInvoiceLines.id,
      accountId: purchaseInvoiceLines.accountId,
      accountName: chartOfAccounts.name,
      qty: purchaseInvoiceLines.qty,
      unitPrice: purchaseInvoiceLines.unitPrice,
    })
    .from(purchaseInvoiceLines)
    .innerJoin(chartOfAccounts, eq(purchaseInvoiceLines.accountId, chartOfAccounts.id))
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, invoice.id));

  const linesWithSubtotal = lines.map((l) => ({ ...l, subtotal: Number(l.qty) * Number(l.unitPrice) }));
  const invoiceAmount = linesWithSubtotal.reduce((sum, l) => sum + l.subtotal, 0);

  // Balance due dihitung dari Payments yang dialokasikan (§1.10 dokumen analisis).
  // Modul Payments BELUM ada, jadi selama status 'approved' balanceDue = invoiceAmount penuh.
  let balanceDue = 0;
let paymentStatus: 'Coming due' | 'Overdue' | 'Paid in full' | null = null;

if (invoice.status === 'approved') {
  const [paidRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .where(eq(paymentLines.purchaseInvoiceId, invoice.id));

  balanceDue = invoiceAmount - Number(paidRow.total);
  const isOverdue = invoice.dueDate ? new Date(invoice.dueDate) < new Date() : false;
  paymentStatus = balanceDue <= 0 ? 'Paid in full' : isOverdue ? 'Overdue' : 'Coming due';
}

  const [supplier] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, invoice.supplierId))
    .limit(1);

  return {
    ...invoice,
    supplierName: supplier?.name ?? '',
    lines: linesWithSubtotal,
    invoiceAmount,
    balanceDue,
    paymentStatus,
  };
}

export async function listPurchaseInvoices(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.businessId, businessId));

  const rows = await db
    .select()
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.businessId, businessId))
    .orderBy(purchaseInvoices.issueDate, purchaseInvoices.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getPurchaseInvoiceById(businessId: string, purchaseInvoiceId: string) {
  const [row] = await db
    .select()
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createPurchaseInvoice(
  businessId: string,
  data: {
    supplierId: string;
    issueDate: string;
    dueDate?: string;
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

  const id = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(purchaseInvoices)
      .values({ businessId, ...header } as typeof purchaseInvoices.$inferInsert)
      .returning();

    await tx.insert(purchaseInvoiceLines).values(
      lines.map((l) => ({
        purchaseInvoiceId: invoice.id,
        accountId: l.accountId,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return invoice.id;
  });

  return { result: await getPurchaseInvoiceById(businessId, id), error: null };
}

export async function updatePurchaseInvoice(
  businessId: string,
  purchaseInvoiceId: string,
  data: Partial<{
    supplierId: string;
    issueDate: string;
    dueDate: string;
    reference: string;
    description: string;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select({ status: purchaseInvoices.status })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
    .limit(1);

  if (!existing) return { result: null, error: 'NOT_FOUND' as const };
  if (existing.status !== 'draft') return { result: null, error: 'NOT_DRAFT' as const };

  const { lines, ...header } = data;

  if (header.supplierId && !(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }
  if (lines && !(await areValidExpenseAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(purchaseInvoices).set(header).where(eq(purchaseInvoices.id, purchaseInvoiceId));
    }
    if (lines) {
      await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoiceId));
      await tx.insert(purchaseInvoiceLines).values(
        lines.map((l) => ({
          purchaseInvoiceId,
          accountId: l.accountId,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getPurchaseInvoiceById(businessId, purchaseInvoiceId), error: null };
}

export async function deletePurchaseInvoice(businessId: string, purchaseInvoiceId: string) {
  const [existing] = await db
    .select({ status: purchaseInvoices.status })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false, blocked: false };
  if (existing.status !== 'draft') return { deleted: false, blocked: true };

  await db.delete(purchaseInvoices).where(eq(purchaseInvoices.id, purchaseInvoiceId));
  return { deleted: true, blocked: false };
}

// Approve: posting jurnal - Debit akun Expense per baris (dikelompokkan per akun),
// Credit Utang Usaha (2000) sebesar total, atas nama supplier. Kebalikan dari Sales Invoice.
export async function approvePurchaseInvoice(businessId: string, purchaseInvoiceId: string) {
  const invoice = await getPurchaseInvoiceById(businessId, purchaseInvoiceId);
  if (!invoice) return { result: null, error: null };
  if (invoice.status !== 'draft') return { result: null, error: 'STATUS_NOT_DRAFT' as const };
  if (invoice.lines.length === 0) return { result: null, error: 'NO_LINES' as const };

  const apAccount = await findApControlAccount(businessId);
  if (!apAccount) return { result: null, error: 'NO_AP_ACCOUNT' as const };
  const lockedUntil = await findLockedUntil(businessId, [], invoice.issueDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: invoice.issueDate,
        sourceModule: 'purchase_invoice',
        sourceId: invoice.id,
        description: invoice.reference ?? `Faktur Pembelian - ${invoice.supplierName}`,
      })
      .returning();

    const grouped = new Map<string, number>();
    for (const line of invoice.lines) {
      grouped.set(line.accountId, (grouped.get(line.accountId) ?? 0) + line.subtotal);
    }
    for (const [accountId, amount] of grouped) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journalEntry.id,
        accountId,
        debit: amount.toString(),
        credit: '0.00',
      });
    }

    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: apAccount.id,
      contactId: invoice.supplierId,
      debit: '0.00',
      credit: invoice.invoiceAmount.toString(),
    });

    await tx
      .update(purchaseInvoices)
      .set({ status: 'approved', journalEntryId: journalEntry.id })
      .where(eq(purchaseInvoices.id, purchaseInvoiceId));
  });

  return { result: await getPurchaseInvoiceById(businessId, purchaseInvoiceId), error: null };
}

// Void: jurnal PEMBALIK (bukan hapus jurnal asli) - prinsip jurnal permanen (§6.1 tugas 1.1).
export async function voidPurchaseInvoice(businessId: string, purchaseInvoiceId: string) {
  const invoice = await getPurchaseInvoiceById(businessId, purchaseInvoiceId);
  if (!invoice) return { result: null, error: null };
  if (invoice.status !== 'approved') return { result: null, error: 'STATUS_NOT_APPROVED' as const };
  if (!invoice.journalEntryId) return { result: null, error: 'NO_JOURNAL' as const };
  const lockedUntil = await findLockedUntil(businessId, [], invoice.issueDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, invoice.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceModule: 'purchase_invoice_void',
        sourceId: invoice.id,
        description: `Pembalik faktur pembelian ${invoice.reference ?? invoice.id} (void)`,
      })
      .returning();

    for (const line of originalLines) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        contactId: line.contactId,
        debit: line.credit, // dibalik
        credit: line.debit,
      });
    }

    await tx.update(purchaseInvoices).set({ status: 'void' }).where(eq(purchaseInvoices.id, purchaseInvoiceId));
  });

  return { result: await getPurchaseInvoiceById(businessId, purchaseInvoiceId), error: null };
}

// Sama seperti Sales Invoice, tapi tidak ada pengurang alokasi karena modul
// Payments belum ada - balanceDue untuk faktur approved masih penuh.
export async function getPurchaseInvoiceTotals(businessId: string) {
  const [invoiceAmountRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchaseInvoiceLines.qty} * ${purchaseInvoiceLines.unitPrice}), 0)` })
    .from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoices.id))
    .where(eq(purchaseInvoices.businessId, businessId));

  const [approvedAmountRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchaseInvoiceLines.qty} * ${purchaseInvoiceLines.unitPrice}), 0)` })
    .from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoices.id))
    .where(and(eq(purchaseInvoices.businessId, businessId), eq(purchaseInvoices.status, 'approved')));

  // Kurangi pembayaran yang sudah dialokasikan ke faktur approved - sekarang
  // modul Payments sudah ada, sama seperti pengurang Receipts pada Sales Invoices.
  const [paidRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .innerJoin(purchaseInvoices, eq(paymentLines.purchaseInvoiceId, purchaseInvoices.id))
    .where(and(eq(purchaseInvoices.businessId, businessId), eq(purchaseInvoices.status, 'approved')));

  return {
    totalInvoiceAmount: Number(invoiceAmountRow.total),
    totalBalanceDue: Number(approvedAmountRow.total) - Number(paidRow.total),
  };
}