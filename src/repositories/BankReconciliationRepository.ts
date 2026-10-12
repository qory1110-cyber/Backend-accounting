import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  bankAccounts,
  bankReconciliations,
  interAccountTransfers,
  journalEntries,
  journalEntryLines,
  paymentLines,
  payments,
  receiptLines,
  receipts,
} from '../db/schema.js';

type UnclearedItem = {
  type: 'payment' | 'receipt' | 'transfer_out' | 'transfer_in';
  id: string;
  date: string;
  reference: string;
  amount: number;
  kind: 'withdrawal' | 'deposit';
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Formula B: Discrepancy = Statement - (Book + Uncleared Withdrawals - Uncleared Deposits).
// Semua angka dihitung sampai tanggal cutoff (opsi 1).
async function computeFigures(
  businessId: string,
  bankAccountId: string,
  cutoff: string,
  statementBalance: number,
) {
  const [bank] = await db
    .select({ controlAccountId: bankAccounts.controlAccountId, openingBalance: bankAccounts.openingBalance })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1);

  const [ledger] = await db
    .select({
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntryLines.accountId, bank.controlAccountId),
        eq(journalEntries.businessId, businessId),
        lte(journalEntries.entryDate, cutoff),
      ),
    );
  const bookBalance = round2(Number(bank.openingBalance) + Number(ledger.totalDebit) - Number(ledger.totalCredit));

  const paymentRows = await db
    .select({
      id: payments.id,
      date: payments.paymentDate,
      reference: payments.reference,
      amount: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)`,
    })
    .from(payments)
    .innerJoin(paymentLines, eq(paymentLines.paymentId, payments.id))
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(payments.paidFromBankAccountId, bankAccountId),
        eq(payments.cleared, false),
        lte(payments.paymentDate, cutoff),
      ),
    )
    .groupBy(payments.id, payments.paymentDate, payments.reference);

  const receiptRows = await db
    .select({
      id: receipts.id,
      date: receipts.receiptDate,
      reference: receipts.reference,
      amount: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)`,
    })
    .from(receipts)
    .innerJoin(receiptLines, eq(receiptLines.receiptId, receipts.id))
    .where(
      and(
        eq(receipts.businessId, businessId),
        eq(receipts.receivedInBankAccountId, bankAccountId),
        eq(receipts.cleared, false),
        lte(receipts.receiptDate, cutoff),
      ),
    )
    .groupBy(receipts.id, receipts.receiptDate, receipts.reference);

  const transferOutRows = await db
    .select()
    .from(interAccountTransfers)
    .where(
      and(
        eq(interAccountTransfers.businessId, businessId),
        eq(interAccountTransfers.paidFromBankAccountId, bankAccountId),
        eq(interAccountTransfers.paidFromCleared, false),
        lte(interAccountTransfers.transferDate, cutoff),
      ),
    );

  const transferInRows = await db
    .select()
    .from(interAccountTransfers)
    .where(
      and(
        eq(interAccountTransfers.businessId, businessId),
        eq(interAccountTransfers.receivedInBankAccountId, bankAccountId),
        eq(interAccountTransfers.receivedInCleared, false),
        lte(interAccountTransfers.transferDate, cutoff),
      ),
    );

  const unclearedTransactions: UnclearedItem[] = [
    ...paymentRows.map((r) => ({ type: 'payment' as const, id: r.id, date: r.date, reference: r.reference, amount: Number(r.amount), kind: 'withdrawal' as const })),
    ...transferOutRows.map((r) => ({ type: 'transfer_out' as const, id: r.id, date: r.transferDate, reference: r.reference, amount: Number(r.amount), kind: 'withdrawal' as const })),
    ...receiptRows.map((r) => ({ type: 'receipt' as const, id: r.id, date: r.date, reference: r.reference, amount: Number(r.amount), kind: 'deposit' as const })),
    ...transferInRows.map((r) => ({ type: 'transfer_in' as const, id: r.id, date: r.transferDate, reference: r.reference, amount: Number(r.amount), kind: 'deposit' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const unclearedWithdrawals = round2(unclearedTransactions.filter((t) => t.kind === 'withdrawal').reduce((s, t) => s + t.amount, 0));
  const unclearedDeposits = round2(unclearedTransactions.filter((t) => t.kind === 'deposit').reduce((s, t) => s + t.amount, 0));
  const discrepancy = round2(statementBalance - (bookBalance + unclearedWithdrawals - unclearedDeposits));

  return {
    bookBalance,
    unclearedWithdrawals,
    unclearedDeposits,
    discrepancy,
    status: Math.abs(discrepancy) < 0.005 ? ('reconciled' as const) : ('not_reconciled' as const),
    unclearedTransactions,
  };
}

function baseQuery() {
  return db
    .select({
      id: bankReconciliations.id,
      businessId: bankReconciliations.businessId,
      bankAccountId: bankReconciliations.bankAccountId,
      bankAccountName: bankAccounts.name,
      reconciliationDate: bankReconciliations.reconciliationDate,
      statementBalance: bankReconciliations.statementBalance,
    })
    .from(bankReconciliations)
    .innerJoin(bankAccounts, eq(bankReconciliations.bankAccountId, bankAccounts.id));
}

type Row = Awaited<ReturnType<typeof baseQuery>>[number];

async function toSummary(row: Row) {
  const statementBalance = Number(row.statementBalance);
  const { unclearedTransactions: _omit, ...figures } = await computeFigures(
    row.businessId,
    row.bankAccountId,
    row.reconciliationDate,
    statementBalance,
  );
  return { ...row, statementBalance, ...figures };
}

async function toDetail(row: Row) {
  const statementBalance = Number(row.statementBalance);
  const figures = await computeFigures(row.businessId, row.bankAccountId, row.reconciliationDate, statementBalance);
  return { ...row, statementBalance, ...figures };
}

export async function listBankReconciliations(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bankReconciliations)
    .where(eq(bankReconciliations.businessId, businessId));

  const rows = await baseQuery()
    .where(eq(bankReconciliations.businessId, businessId))
    .orderBy(sql`${bankReconciliations.reconciliationDate} DESC`, bankReconciliations.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(toSummary));
  return { data, total: Number(count) };
}

export async function getBankReconciliationById(businessId: string, id: string) {
  const [row] = await baseQuery()
    .where(and(eq(bankReconciliations.id, id), eq(bankReconciliations.businessId, businessId)))
    .limit(1);
  return row ? toDetail(row) : null;
}

// H2: rekonsiliasi yang cocok (Reconciled) dan tanggalnya tidak melewati hari ini
// otomatis memajukan lockDate bank. Hanya maju, tidak pernah mundur.
async function applyAutoLock(rec: { bankAccountId: string; reconciliationDate: string; status: string }) {
  const today = new Date().toISOString().slice(0, 10);
  if (rec.status !== 'reconciled' || rec.reconciliationDate > today) return;
  await db
    .update(bankAccounts)
    .set({ lockDate: rec.reconciliationDate })
    .where(
      and(
        eq(bankAccounts.id, rec.bankAccountId),
        or(isNull(bankAccounts.lockDate), lt(bankAccounts.lockDate, rec.reconciliationDate)),
      ),
    );
}

export async function createBankReconciliation(
  businessId: string,
  data: { bankAccountId: string; reconciliationDate: string; statementBalance: number },
) {
  const [bank] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, data.bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);
  if (!bank) return { result: null, error: 'INVALID_BANK_ACCOUNT' as const };

  const [row] = await db
    .insert(bankReconciliations)
    .values({
      businessId,
      bankAccountId: data.bankAccountId,
      reconciliationDate: data.reconciliationDate,
      statementBalance: data.statementBalance.toString(),
    })
    .returning({ id: bankReconciliations.id });

  const result = await getBankReconciliationById(businessId, row.id);
  if (result) await applyAutoLock(result);
  return { result, error: null };
}

// Bank account tidak boleh diganti; kalau salah bank, hapus lalu buat baru.
export async function updateBankReconciliation(
  businessId: string,
  id: string,
  data: Partial<{ reconciliationDate: string; statementBalance: number }>,
) {
  const [row] = await db
    .update(bankReconciliations)
    .set({
      ...(data.reconciliationDate !== undefined ? { reconciliationDate: data.reconciliationDate } : {}),
      ...(data.statementBalance !== undefined ? { statementBalance: data.statementBalance.toString() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(bankReconciliations.id, id), eq(bankReconciliations.businessId, businessId)))
    .returning({ id: bankReconciliations.id });
  if (!row) return null;
  const result = await getBankReconciliationById(businessId, row.id);
  if (result) await applyAutoLock(result);
  return result;
}

export async function deleteBankReconciliation(businessId: string, id: string) {
  const result = await db
    .delete(bankReconciliations)
    .where(and(eq(bankReconciliations.id, id), eq(bankReconciliations.businessId, businessId)))
    .returning({ id: bankReconciliations.id });
  return result.length > 0;
}

// Tanggal rekonsiliasi terbaru yang discrepancy-nya 0. Status dihitung ulang
// setiap dibaca, jadi rekonsiliasi lama yang kini tidak cocok otomatis tidak dihitung.
export async function getLastReconciledDate(businessId: string, bankAccountId: string): Promise<string | null> {
  const rows = await db
    .select({
      reconciliationDate: bankReconciliations.reconciliationDate,
      statementBalance: bankReconciliations.statementBalance,
    })
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.businessId, businessId), eq(bankReconciliations.bankAccountId, bankAccountId)))
    .orderBy(sql`${bankReconciliations.reconciliationDate} DESC`);

  for (const r of rows) {
    const figures = await computeFigures(businessId, bankAccountId, r.reconciliationDate, Number(r.statementBalance));
    if (figures.status === 'reconciled') return r.reconciliationDate;
  }
  return null;
}