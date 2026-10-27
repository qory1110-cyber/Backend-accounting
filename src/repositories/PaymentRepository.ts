import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  payments,
  paymentLines,
  bankAccounts,
  chartOfAccounts,
  contacts,
  purchaseInvoices,
  expenseClaims,
  expenseClaimLines,
  expenseClaimPayers,
  journalEntries,
  journalEntryLines,
  projects,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';
import { ensureExpenseClaimAccount } from './ExpenseClaimRepository.js';

type LineInput = {
  amount: number;
  purchaseInvoiceId?: string;
  expenseClaimId?: string;
  accountId?: string;
  projectId?: string;
};

// Proyek baris: harus milik bisnis ini dan berstatus Active.
async function validateProjects(businessId: string, projectIds: (string | null | undefined)[]) {
  const unique = [...new Set(projectIds.filter((id): id is string => !!id))];
  if (unique.length === 0) return null;
  const rows = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.businessId, businessId), inArray(projects.id, unique)));
  if (rows.length !== unique.length) return 'INVALID_PROJECT' as const;
  if (rows.some((p) => p.status !== 'active')) return 'INACTIVE_PROJECT' as const;
  return null;
}

async function findApControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '2000')))
    .limit(1);
  return row ?? null;
}

async function getBankAccountInfo(businessId: string, bankAccountId: string) {
  const [row] = await db
    .select({ controlAccountId: bankAccounts.controlAccountId, canHavePendingTransactions: bankAccounts.canHavePendingTransactions })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

// Sisa balanceDue faktur pembelian = invoiceAmount - Σ(baris Payment yang sudah pernah melunasinya).
async function getPurchaseInvoiceRemainingBalance(businessId: string, purchaseInvoiceId: string) {
  const [invoice] = await db
    .select()
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
    .limit(1);
  if (!invoice || invoice.status !== 'approved') return null;

  const lines = await db
    .select({ qty: sql<string>`qty`, unitPrice: sql<string>`unit_price` })
    .from(sql`purchase_invoice_lines`)
    .where(sql`purchase_invoice_id = ${purchaseInvoiceId}`);
  const invoiceAmount = lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);

  const [paid] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .where(eq(paymentLines.purchaseInvoiceId, purchaseInvoiceId));

  return { supplierId: invoice.supplierId, remaining: invoiceAmount - Number(paid.total) };
}

// Sisa saldo klaim = total baris klaim - Σ(baris Payment yang sudah melunasinya).
async function getExpenseClaimRemainingBalance(businessId: string, expenseClaimId: string) {
  const [row] = await db
    .select({ payerContactId: expenseClaimPayers.contactId })
    .from(expenseClaims)
    .innerJoin(expenseClaimPayers, eq(expenseClaims.payerId, expenseClaimPayers.id))
    .where(and(eq(expenseClaims.id, expenseClaimId), eq(expenseClaims.businessId, businessId)))
    .limit(1);
  if (!row) return null;

  const [total] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expenseClaimLines.amount}), 0)` })
    .from(expenseClaimLines)
    .where(eq(expenseClaimLines.expenseClaimId, expenseClaimId));

  const [paid] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .where(eq(paymentLines.expenseClaimId, expenseClaimId));

  return { payerContactId: row.payerContactId, remaining: Number(total.total) - Number(paid.total) };
}

async function attachDetail(payment: typeof payments.$inferSelect) {
  const lines = await db
    .select({
      id: paymentLines.id,
      accountId: paymentLines.accountId,
      accountName: chartOfAccounts.name,
      purchaseInvoiceId: paymentLines.purchaseInvoiceId,
      purchaseInvoiceReference: purchaseInvoices.reference,
      expenseClaimId: paymentLines.expenseClaimId,
      expenseClaimReference: expenseClaims.reference,
      amount: paymentLines.amount,
      projectId: paymentLines.projectId,
      projectName: projects.name,
    })
    .from(paymentLines)
    .innerJoin(chartOfAccounts, eq(paymentLines.accountId, chartOfAccounts.id))
    .leftJoin(purchaseInvoices, eq(paymentLines.purchaseInvoiceId, purchaseInvoices.id))
    .leftJoin(expenseClaims, eq(paymentLines.expenseClaimId, expenseClaims.id))
    .leftJoin(projects, eq(paymentLines.projectId, projects.id))
    .where(eq(paymentLines.paymentId, payment.id));

  const totalAmount = lines.reduce((sum, l) => sum + Number(l.amount), 0);

  const [bankAccount] = await db
    .select({ name: bankAccounts.name })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, payment.paidFromBankAccountId))
    .limit(1);

  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, payment.payeeContactId))
    .limit(1);

  return {
    ...payment,
    paidFromBankAccountName: bankAccount?.name ?? '',
    payeeContactName: contact?.name ?? '',
    lines,
    totalAmount,
  };
}

export async function listPayments(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(payments)
    .where(eq(payments.businessId, businessId));

  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.businessId, businessId))
    .orderBy(payments.paymentDate, payments.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachDetail));
  return { data, total: Number(count) };
}

export async function getPaymentById(businessId: string, paymentId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
    .limit(1);
  return row ? attachDetail(row) : null;
}

export async function getPaymentTotals(businessId: string) {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .innerJoin(payments, eq(paymentLines.paymentId, payments.id))
    .where(eq(payments.businessId, businessId));
  return { totalAmount: Number(row.total) };
}

export async function createPayment(
  businessId: string,
  data: {
    paymentDate: string;
    reference?: string;
    paidFromBankAccountId: string;
    payeeContactId: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const bankAccountInfo = await getBankAccountInfo(businessId, data.paidFromBankAccountId);
  if (!bankAccountInfo) return { result: null, error: 'INVALID_BANK_ACCOUNT' as const };
  const lockedUntil = await findLockedUntil(businessId, [data.paidFromBankAccountId], data.paymentDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  const [payee] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, data.payeeContactId), eq(contacts.businessId, businessId)))
    .limit(1);
  if (!payee) return { result: null, error: 'INVALID_PAYEE' as const };

  const apAccount = await findApControlAccount(businessId);

  const resolvedLines: {
    accountId: string;
    purchaseInvoiceId?: string;
    expenseClaimId?: string;
    contactId?: string;
    projectId?: string;
    amount: number;
  }[] = [];
  const claimAllocated = new Map<string, number>(); // total alokasi per klaim dalam satu Payment
  for (const line of data.lines) {
    if (line.expenseClaimId) {
      const claimInfo = await getExpenseClaimRemainingBalance(businessId, line.expenseClaimId);
      if (!claimInfo) return { result: null, error: 'INVALID_CLAIM' as const };
      if (claimInfo.payerContactId !== data.payeeContactId) {
        return { result: null, error: 'CLAIM_PAYEE_MISMATCH' as const };
      }
      const allocated = (claimAllocated.get(line.expenseClaimId) ?? 0) + line.amount;
      if (allocated > claimInfo.remaining + 0.01) return { result: null, error: 'OVERPAYMENT' as const };
      claimAllocated.set(line.expenseClaimId, allocated);
      const claimAccount = await ensureExpenseClaimAccount(businessId);
      resolvedLines.push({
        accountId: claimAccount.id,
        expenseClaimId: line.expenseClaimId,
        contactId: claimInfo.payerContactId,
        amount: line.amount,
      });
    } else if (line.purchaseInvoiceId) {
      if (!apAccount) return { result: null, error: 'NO_AP_ACCOUNT' as const };
      const invoiceInfo = await getPurchaseInvoiceRemainingBalance(businessId, line.purchaseInvoiceId);
if (!invoiceInfo) return { result: null, error: 'INVALID_INVOICE' as const };
if (line.amount > invoiceInfo.remaining + 0.01) return { result: null, error: 'OVERPAYMENT' as const };
resolvedLines.push({
  accountId: apAccount.id,
  purchaseInvoiceId: line.purchaseInvoiceId,
  contactId: invoiceInfo.supplierId,
  amount: line.amount,
});
    } else {
      const [account] = await db
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.id, line.accountId!), eq(chartOfAccounts.businessId, businessId)))
        .limit(1);
      if (!account) return { result: null, error: 'INVALID_ACCOUNT' as const };
      if (account.id === bankAccountInfo.controlAccountId) {
        return { result: null, error: 'ACCOUNT_SAME_AS_BANK' as const };
      }
resolvedLines.push({
        accountId: line.accountId!,
        contactId: data.payeeContactId,
        projectId: line.projectId,
        amount: line.amount,
      });
    }
  }

  const projectError = await validateProjects(businessId, resolvedLines.map((l) => l.projectId));
  if (projectError) return { result: null, error: projectError };

  const reference = data.reference?.trim() || `PAY-${Date.now()}`;
  const totalAmount = resolvedLines.reduce((sum, l) => sum + l.amount, 0);
  // Cleared otomatis true kalau bank sumber dana TIDAK pakai pending transactions
  // (tidak relevan baginya); kalau bank-nya pakai fitur itu, defaultnya belum Cleared.
  const distinctContacts = new Set(resolvedLines.map((l) => l.contactId).filter((c): c is string => !!c));
  const bankLineContactId = distinctContacts.size <= 1 ? data.payeeContactId : undefined;
  const cleared = !bankAccountInfo.canHavePendingTransactions;

  const id = await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({ businessId, entryDate: data.paymentDate, sourceModule: 'payment', description: reference })
      .returning();

    // Credit satu baris untuk total pengeluaran dari akun kontrol bank sumber dana.
    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: bankAccountInfo.controlAccountId,
      contactId: bankLineContactId,
      debit: '0.00',
      credit: totalAmount.toString(),
    });

    // Debit dikelompokkan per akun.
const grouped = new Map<string, { accountId: string; contactId?: string; projectId?: string; amount: number }>();
for (const l of resolvedLines) {
const key = `${l.accountId}:${l.contactId ?? ''}:${l.projectId ?? ''}`;
const entry = grouped.get(key) ?? { accountId: l.accountId, contactId: l.contactId, projectId: l.projectId, amount: 0 };
  entry.amount += l.amount;
  grouped.set(key, entry);
}
for (const { accountId, contactId, projectId, amount } of grouped.values()) {
  await tx.insert(journalEntryLines).values({
    journalEntryId: journalEntry.id,
    accountId,
    contactId,
    projectId,
    debit: amount.toString(),
    credit: '0.00',
  });
}

    const [payment] = await tx
      .insert(payments)
      .values({
        businessId,
        paymentDate: data.paymentDate,
        reference,
        paidFromBankAccountId: data.paidFromBankAccountId,
        payeeContactId: data.payeeContactId,
        description: data.description,
        cleared,
        journalEntryId: journalEntry.id,
      })
      .returning();

    await tx.insert(paymentLines).values(
      resolvedLines.map((l) => ({
        paymentId: payment.id,
        accountId: l.accountId,
        purchaseInvoiceId: l.purchaseInvoiceId,
        expenseClaimId: l.expenseClaimId,
        projectId: l.projectId ?? null,
        amount: l.amount.toString(),
      })),
    );

    return payment.id;
  });

  return { result: await getPaymentById(businessId, id), error: null };
}

export async function setPaymentCleared(businessId: string, paymentId: string, cleared: boolean) {
  const [row] = await db
    .update(payments)
    .set({ cleared })
    .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
    .returning();
  return row ? getPaymentById(businessId, paymentId) : null;
}

// Sama seperti Receipts: tidak ada status/edit pada Payment. Hapus memposting
// jurnal pembalik, baru menghapus baris header.
export async function deletePayment(businessId: string, paymentId: string) {
  const payment = await getPaymentById(businessId, paymentId);
  if (!payment) return { deleted: false, lockedUntil: null };
  const lockedUntil = await findLockedUntil(businessId, [payment.paidFromBankAccountId], payment.paymentDate);
  if (lockedUntil) return { deleted: false, lockedUntil };

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, payment.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceModule: 'payment_void',
        sourceId: payment.id,
        description: `Pembalik pembayaran ${payment.reference}`,
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

    await tx.delete(payments).where(eq(payments.id, paymentId));
  });

  return { deleted: true, lockedUntil: null };
}