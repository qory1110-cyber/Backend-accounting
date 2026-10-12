import { and, eq, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  receipts,
  receiptLines,
  bankAccounts,
  chartOfAccounts,
  contacts,
  salesInvoices,
  journalEntries,
  journalEntryLines,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

type LineInput = { amount: number; salesInvoiceId?: string; accountId?: string };

async function findArControlAccount(businessId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, '1200')))
    .limit(1);
  return row ?? null;
}

async function getBankAccountControlAccount(businessId: string, bankAccountId: string) {
  const [row] = await db
    .select({ controlAccountId: bankAccounts.controlAccountId })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

// Sisa balanceDue faktur = invoiceAmount - Σ(baris rincian yang sudah pernah melunasinya).
// Query langsung, tanpa memanggil SalesInvoiceRepository, supaya tidak ada dependensi melingkar.
async function getInvoiceRemainingBalance(businessId: string, salesInvoiceId: string) {
  const [invoice] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
    .limit(1);
  if (!invoice || invoice.status !== 'sent') return null;

  const lines = await db
    .select({ qty: sql<string>`qty`, unitPrice: sql<string>`unit_price` })
    .from(sql`sales_invoice_lines`)
    .where(sql`sales_invoice_id = ${salesInvoiceId}`);
  const invoiceAmount = lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);

  const [allocated] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .where(eq(receiptLines.salesInvoiceId, salesInvoiceId));

  return { customerId: invoice.customerId, remaining: invoiceAmount - Number(allocated.total) };
}

async function attachDetail(receipt: typeof receipts.$inferSelect) {
  const lines = await db
    .select({
      id: receiptLines.id,
      accountId: receiptLines.accountId,
      accountName: chartOfAccounts.name,
      salesInvoiceId: receiptLines.salesInvoiceId,
      salesInvoiceReference: salesInvoices.reference,
      amount: receiptLines.amount,
    })
    .from(receiptLines)
    .innerJoin(chartOfAccounts, eq(receiptLines.accountId, chartOfAccounts.id))
    .leftJoin(salesInvoices, eq(receiptLines.salesInvoiceId, salesInvoices.id))
    .where(eq(receiptLines.receiptId, receipt.id));

  const totalAmount = lines.reduce((sum, l) => sum + Number(l.amount), 0);

  const [bankAccount] = await db
    .select({ name: bankAccounts.name })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, receipt.receivedInBankAccountId))
    .limit(1);

  let paidByContactName: string | null = null;
  if (receipt.paidByContactId) {
    const [contact] = await db
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, receipt.paidByContactId))
      .limit(1);
    paidByContactName = contact?.name ?? null;
  }

  return {
    ...receipt,
    receivedInBankAccountName: bankAccount?.name ?? '',
    paidByContactName,
    lines,
    totalAmount,
  };
}

export async function listReceipts(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(receipts)
    .where(eq(receipts.businessId, businessId));

  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.businessId, businessId))
    .orderBy(receipts.receiptDate, receipts.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachDetail));
  return { data, total: Number(count) };
}

export async function getReceiptById(businessId: string, receiptId: string) {
  const [row] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.businessId, businessId)))
    .limit(1);
  return row ? attachDetail(row) : null;
}

export async function getReceiptTotals(businessId: string) {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .where(eq(receipts.businessId, businessId));
  return { totalAmount: Number(row.total) };
}

// §3.4: Receipt langsung final & posting jurnal saat dibuat - tidak ada tahap draft.
export async function createReceipt(
  businessId: string,
  data: {
    receiptDate: string;
    reference?: string;
    receivedInBankAccountId: string;
    paidByContactId?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const bankAccount = await getBankAccountControlAccount(businessId, data.receivedInBankAccountId);
  if (!bankAccount) return { result: null, error: 'INVALID_BANK_ACCOUNT' as const };
  const lockedUntil = await findLockedUntil([data.receivedInBankAccountId], data.receiptDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  const arAccount = await findArControlAccount(businessId);

  const resolvedLines: { accountId: string; salesInvoiceId?: string; contactId?: string; amount: number }[] = [];
  for (const line of data.lines) {
    if (line.salesInvoiceId) {
      if (!arAccount) return { result: null, error: 'NO_AR_ACCOUNT' as const };
      const invoiceInfo = await getInvoiceRemainingBalance(businessId, line.salesInvoiceId);
      if (!invoiceInfo) return { result: null, error: 'INVALID_INVOICE' as const };
      if (line.amount > invoiceInfo.remaining + 0.01) return { result: null, error: 'OVERPAYMENT' as const };
      // Kontak baris = pelanggan pemilik faktur itu sendiri, bukan Paid by di header.
      resolvedLines.push({
        accountId: arAccount.id,
        salesInvoiceId: line.salesInvoiceId,
        contactId: invoiceInfo.customerId,
        amount: line.amount,
      });
    } else {
      const [account] = await db
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.id, line.accountId!), eq(chartOfAccounts.businessId, businessId)))
        .limit(1);
      if (!account) return { result: null, error: 'INVALID_ACCOUNT' as const };
      if (account.id === bankAccount.controlAccountId) {
        return { result: null, error: 'ACCOUNT_SAME_AS_BANK' as const };
      }
      resolvedLines.push({ accountId: line.accountId!, contactId: data.paidByContactId, amount: line.amount });
    }
  }

  // Paid by di header: yang diisi pengguna; kalau kosong, diisi otomatis hanya
  // bila semua faktur milik satu pelanggan yang sama.
  const invoiceCustomerIds = new Set(
    resolvedLines.filter((l) => l.salesInvoiceId).map((l) => l.contactId as string),
  );
  const effectivePayerId =
    data.paidByContactId ?? (invoiceCustomerIds.size === 1 ? [...invoiceCustomerIds][0] : undefined);

  // Baris debit bank membawa kontak hanya kalau seluruh receipt hanya melibatkan satu pihak.
  const distinctContacts = new Set(resolvedLines.map((l) => l.contactId).filter((c): c is string => !!c));
  const bankLineContactId = distinctContacts.size <= 1 ? effectivePayerId : undefined;

  const reference = data.reference?.trim() || `REC-${Date.now()}`;
  const totalAmount = resolvedLines.reduce((sum, l) => sum + l.amount, 0);

  const id = await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: data.receiptDate,
        sourceModule: 'receipt',
        description: reference,
      })
      .returning();

    await tx.insert(journalEntryLines).values({
      journalEntryId: journalEntry.id,
      accountId: bankAccount.controlAccountId,
      contactId: bankLineContactId,
      debit: totalAmount.toString(),
      credit: '0.00',
    });

    // Kredit dikelompokkan per PASANGAN akun + kontak, supaya piutang tiap
    // pelanggan tercatat atas namanya sendiri.
    const grouped = new Map<string, { accountId: string; contactId?: string; amount: number }>();
    for (const l of resolvedLines) {
      const key = `${l.accountId}:${l.contactId ?? ''}`;
      const entry = grouped.get(key) ?? { accountId: l.accountId, contactId: l.contactId, amount: 0 };
      entry.amount += l.amount;
      grouped.set(key, entry);
    }
    for (const { accountId, contactId, amount } of grouped.values()) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journalEntry.id,
        accountId,
        contactId,
        debit: '0.00',
        credit: amount.toString(),
      });
    }

    const [receipt] = await tx
      .insert(receipts)
      .values({
        businessId,
        receiptDate: data.receiptDate,
        reference,
        receivedInBankAccountId: data.receivedInBankAccountId,
        paidByContactId: effectivePayerId,
        description: data.description,
        journalEntryId: journalEntry.id,
      })
      .returning();

    await tx.insert(receiptLines).values(
      resolvedLines.map((l) => ({
        receiptId: receipt.id,
        accountId: l.accountId,
        salesInvoiceId: l.salesInvoiceId,
        amount: l.amount.toString(),
      })),
    );

    return receipt.id;
  });

  return { result: await getReceiptById(businessId, id), error: null };
}

// Tidak ada status "void" pada Receipt (§3.5 - tidak ada alur status). Jurnal tetap
// permanen lewat pembalik; baris header Receipt boleh dihapus karena kebenaran saldo
// hidup di journal_entries, bukan di tabel ini.
export async function deleteReceipt(businessId: string, receiptId: string) {
  const receipt = await getReceiptById(businessId, receiptId);
    if (!receipt) return { deleted: false, lockedUntil: null };
  const lockedUntil = await findLockedUntil([receipt.receivedInBankAccountId], receipt.receiptDate);
  if (lockedUntil) return { deleted: false, lockedUntil };

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, receipt.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceModule: 'receipt_void',
        sourceId: receipt.id,
        description: `Pembalik penerimaan ${receipt.reference}`,
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

    await tx.delete(receipts).where(eq(receipts.id, receiptId));
  });

  return { deleted: true, lockedUntil: null };
}

export async function setReceiptCleared(businessId: string, receiptId: string, cleared: boolean) {
  const [row] = await db
    .update(receipts)
    .set({ cleared })
    .where(and(eq(receipts.id, receiptId), eq(receipts.businessId, businessId)))
    .returning();
  return row ? getReceiptById(businessId, receiptId) : null;
}