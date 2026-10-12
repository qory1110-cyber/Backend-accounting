import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  salesInvoices,
  salesInvoiceLines,
  chartOfAccounts,
  contacts,
  journalEntries,
  journalEntryLines,
  receiptLines,
} from '../db/schema.js';

type LineInput = { accountId: string; qty: number; unitPrice: number };

async function findArControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '1200')))
    .limit(1);
  return row ?? null;
}

// Validasi di backend (bukan cuma frontend): pelanggan harus is_customer & milik bisnis ini.
async function isValidCustomer(businessId: string, customerId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
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

async function attachComputedFields(invoice: typeof salesInvoices.$inferSelect) {
  const lines = await db
    .select({
      id: salesInvoiceLines.id,
      accountId: salesInvoiceLines.accountId,
      accountName: chartOfAccounts.name,
      qty: salesInvoiceLines.qty,
      unitPrice: salesInvoiceLines.unitPrice,
    })
    .from(salesInvoiceLines)
    .innerJoin(chartOfAccounts, eq(salesInvoiceLines.accountId, chartOfAccounts.id))
    .where(eq(salesInvoiceLines.salesInvoiceId, invoice.id));

  const linesWithSubtotal = lines.map((l) => ({ ...l, subtotal: Number(l.qty) * Number(l.unitPrice) }));
  const invoiceAmount = linesWithSubtotal.reduce((sum, l) => sum + l.subtotal, 0);

  // Balance Due & Payment Status: butuh modul Receipts (belum ada),
  // jadi balanceDue = invoiceAmount penuh selama status 'sent'.
  let balanceDue = 0;
let paymentStatus: 'Unpaid' | 'Overdue' | 'Paid' | null = null;

if (invoice.status === 'sent') {
  // Balance due sekarang benar-benar dikurangi oleh Receipts yang mengalokasikan
  // ke faktur ini, bukan lagi selalu sama dengan invoiceAmount penuh.
  const [allocated] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .where(eq(receiptLines.salesInvoiceId, invoice.id));

  balanceDue = invoiceAmount - Number(allocated.total);
  const isOverdue = invoice.dueDate ? new Date(invoice.dueDate) < new Date() : false;
  paymentStatus = balanceDue <= 0 ? 'Paid' : isOverdue ? 'Overdue' : 'Unpaid';
}

  const [customer] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, invoice.customerId))
    .limit(1);

  return {
    ...invoice,
    customerName: customer?.name ?? '',
    lines: linesWithSubtotal,
    invoiceAmount,
    balanceDue,
    paymentStatus,
  };
}

export async function listSalesInvoices(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(salesInvoices)
    .where(eq(salesInvoices.businessId, businessId));

  const rows = await db
    .select()
    .from(salesInvoices)
    .where(eq(salesInvoices.businessId, businessId))
    .orderBy(salesInvoices.issueDate, salesInvoices.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getSalesInvoiceById(businessId: string, salesInvoiceId: string) {
  const [row] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createSalesInvoice(
  businessId: string,
  data: {
    customerId: string;
    issueDate: string;
    dueDate?: string;
    reference?: string;
    billingAddress?: string;
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

  const id = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(salesInvoices)
      .values({ businessId, ...header } as typeof salesInvoices.$inferInsert)
      .returning();

    await tx.insert(salesInvoiceLines).values(
      lines.map((l) => ({
        salesInvoiceId: invoice.id,
        accountId: l.accountId,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return invoice.id;
  });

  return { result: await getSalesInvoiceById(businessId, id), error: null };
}

export async function updateSalesInvoice(
  businessId: string,
  salesInvoiceId: string,
  data: Partial<{
    customerId: string;
    issueDate: string;
    dueDate: string;
    reference: string;
    billingAddress: string;
    description: string;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select({ status: salesInvoices.status })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
    .limit(1);

  if (!existing) return { result: null, error: 'NOT_FOUND' as const };
  if (existing.status !== 'draft') return { result: null, error: 'NOT_DRAFT' as const };

  const { lines, ...header } = data;

  if (header.customerId && !(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }
  if (lines && !(await areValidIncomeAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(salesInvoices).set(header).where(eq(salesInvoices.id, salesInvoiceId));
    }
    if (lines) {
      await tx.delete(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, salesInvoiceId));
      await tx.insert(salesInvoiceLines).values(
        lines.map((l) => ({
          salesInvoiceId,
          accountId: l.accountId,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getSalesInvoiceById(businessId, salesInvoiceId), error: null };
}

export async function deleteSalesInvoice(businessId: string, salesInvoiceId: string) {
  const [existing] = await db
    .select({ status: salesInvoices.status })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false, blocked: false };
  if (existing.status !== 'draft') return { deleted: false, blocked: true };

  await db.delete(salesInvoices).where(eq(salesInvoices.id, salesInvoiceId));
  return { deleted: true, blocked: false };
}

// §10.4 aturan #1 & #2: validasi + posting jurnal (Debit AR, Credit Income per akun).
export async function sendSalesInvoice(businessId: string, salesInvoiceId: string) {
  const invoice = await getSalesInvoiceById(businessId, salesInvoiceId);
  if (!invoice) return { result: null, error: null };
  if (invoice.status !== 'draft') return { result: null, error: 'STATUS_NOT_DRAFT' as const };
  if (invoice.lines.length === 0) return { result: null, error: 'NO_LINES' as const };

  const arAccount = await findArControlAccount(businessId);
  if (!arAccount) return { result: null, error: 'NO_AR_ACCOUNT' as const };

  await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: invoice.issueDate,
        sourceModule: 'sales_invoice',
        sourceId: invoice.id,
        description: invoice.reference ?? `Faktur Penjualan - ${invoice.customerName}`,
      })
      .returning();

    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: arAccount.id,
      contactId: invoice.customerId,
      debit: invoice.invoiceAmount.toString(),
      credit: '0.00',
    });

    const grouped = new Map<string, number>();
    for (const line of invoice.lines) {
      grouped.set(line.accountId, (grouped.get(line.accountId) ?? 0) + line.subtotal);
    }
    for (const [accountId, amount] of grouped) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journalEntry.id,
        accountId,
        debit: '0.00',
        credit: amount.toString(),
      });
    }

    await tx
      .update(salesInvoices)
      .set({ status: 'sent', journalEntryId: journalEntry.id })
      .where(eq(salesInvoices.id, salesInvoiceId));
  });

  return { result: await getSalesInvoiceById(businessId, salesInvoiceId), error: null };
}

// Void: posting JURNAL PEMBALIK (bukan hapus jurnal asli) - §6.1 prinsip permanen.
export async function voidSalesInvoice(businessId: string, salesInvoiceId: string) {
  const invoice = await getSalesInvoiceById(businessId, salesInvoiceId);
  if (!invoice) return { result: null, error: null };
  if (invoice.status !== 'sent') return { result: null, error: 'STATUS_NOT_SENT' as const };
  if (!invoice.journalEntryId) return { result: null, error: 'NO_JOURNAL' as const };

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
        sourceModule: 'sales_invoice_void',
        sourceId: invoice.id,
        description: `Pembalik faktur ${invoice.reference ?? invoice.id} (void)`,
      })
      .returning();

    for (const line of originalLines) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        contactId: line.contactId,
        debit: line.credit,
        credit: line.debit,
      });
    }

    await tx.update(salesInvoices).set({ status: 'void' }).where(eq(salesInvoices.id, salesInvoiceId));
  });

  return { result: await getSalesInvoiceById(businessId, salesInvoiceId), error: null };
}

// Total agregat dari SELURUH faktur (bukan satu halaman), untuk footer yang
// tidak boleh menyesatkan saat pagination aktif.
export async function getSalesInvoiceTotals(businessId: string) {
  const [invoiceAmountRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesInvoiceLines.qty} * ${salesInvoiceLines.unitPrice}), 0)` })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoiceLines.salesInvoiceId, salesInvoices.id))
    .where(eq(salesInvoices.businessId, businessId));

  const [sentAmountRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesInvoiceLines.qty} * ${salesInvoiceLines.unitPrice}), 0)` })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoiceLines.salesInvoiceId, salesInvoices.id))
    .where(and(eq(salesInvoices.businessId, businessId), eq(salesInvoices.status, 'sent')));

  const [allocatedRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .innerJoin(salesInvoices, eq(receiptLines.salesInvoiceId, salesInvoices.id))
    .where(and(eq(salesInvoices.businessId, businessId), eq(salesInvoices.status, 'sent')));

  return {
    totalInvoiceAmount: Number(invoiceAmountRow.total),
    totalBalanceDue: Number(sentAmountRow.total) - Number(allocatedRow.total),
  };
}