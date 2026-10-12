import { and, eq, sql, desc } from 'drizzle-orm';
import db from '../db/index.js';
import { bankAccounts, chartOfAccounts, journalEntryLines, payments, paymentLines, interAccountTransfers, receipts, receiptLines } from '../db/schema.js';
import { getLastReconciledDate } from './BankReconciliationRepository.js';

// Actual Balance dihitung ulang setiap dibaca (§4.10 dokumen analisis: "agar
// tidak pernah basi") - opening_balance + SUM(debit) - SUM(credit) dari
// journal_entry_lines yang menyentuh Control Account akun ini.
function baseQuery() {
  return db
    .select({
      id: bankAccounts.id,
      businessId: bankAccounts.businessId,
      name: bankAccounts.name,
      code: bankAccounts.code,
      controlAccountId: bankAccounts.controlAccountId,
      controlAccountName: chartOfAccounts.name,
      currencyCode: chartOfAccounts.currencyCode,
      accountNumber: bankAccounts.accountNumber,
      openingBalance: bankAccounts.openingBalance,
      openingBalanceDate: bankAccounts.openingBalanceDate,
      canHavePendingTransactions: bankAccounts.canHavePendingTransactions,
      creditLimit: bankAccounts.creditLimit,
      isActive: bankAccounts.isActive,
      lockDate: bankAccounts.lockDate,
    })
    .from(bankAccounts)
    .innerJoin(chartOfAccounts, eq(bankAccounts.controlAccountId, chartOfAccounts.id));
}

type BankAccountRow = Awaited<ReturnType<typeof baseQuery>>[number];

async function computeActualBalance(controlAccountId: string, openingBalance: string): Promise<number> {
  const [row] = await db
    .select({
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.accountId, controlAccountId));

  return Number(openingBalance) + Number(row.totalDebit) - Number(row.totalCredit);
}

async function computePendingWithdrawals(bankAccountId: string): Promise<number> {
  const [paymentsRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .innerJoin(payments, eq(paymentLines.paymentId, payments.id))
    .where(and(eq(payments.paidFromBankAccountId, bankAccountId), eq(payments.cleared, false)));

  const [transfersRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${interAccountTransfers.amount}), 0)` })
    .from(interAccountTransfers)
    .where(
      and(
        eq(interAccountTransfers.paidFromBankAccountId, bankAccountId),
        eq(interAccountTransfers.paidFromCleared, false),
      ),
    );

  return Number(paymentsRow.total) + Number(transfersRow.total);
}

async function computePendingDeposits(bankAccountId: string): Promise<number> {
  const [receiptsRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .where(and(eq(receipts.receivedInBankAccountId, bankAccountId), eq(receipts.cleared, false)));

  const [transfersRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${interAccountTransfers.amount}), 0)` })
    .from(interAccountTransfers)
    .where(
      and(
        eq(interAccountTransfers.receivedInBankAccountId, bankAccountId),
        eq(interAccountTransfers.receivedInCleared, false),
      ),
    );

  return Number(receiptsRow.total) + Number(transfersRow.total);
}

async function toResponseShape(row: BankAccountRow) {
  const actualBalance = await computeActualBalance(row.controlAccountId, row.openingBalance);
  return {
    ...row,
    actualBalance,
    pendingWithdrawals: await computePendingWithdrawals(row.id),
    pendingDeposits: await computePendingDeposits(row.id),
    lastReconciliationDate: await getLastReconciledDate(row.businessId, row.id),
  };
}

export async function listBankAccounts(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bankAccounts)
    .where(eq(bankAccounts.businessId, businessId));

  const rows = await baseQuery()
    .where(eq(bankAccounts.businessId, businessId))
    .orderBy(bankAccounts.name, bankAccounts.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(toResponseShape));
  return { data, total: Number(count) };
}

// Untuk dropdown pencarian: ringan, diurutkan dari yang TERAKHIR DIUBAH.
export async function listRecentBankAccounts(businessId: string, limit: number) {
  return db
    .select({ id: bankAccounts.id, name: bankAccounts.name, code: bankAccounts.code, isActive: bankAccounts.isActive })
    .from(bankAccounts)
    .where(eq(bankAccounts.businessId, businessId))
    .orderBy(desc(bankAccounts.updatedAt), bankAccounts.name)
    .limit(limit);
}

export async function getBankAccountById(businessId: string, bankAccountId: string) {
  const [row] = await baseQuery()
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);
  return row ? toResponseShape(row) : null;
}

// Validasi §4.4 aturan #1: Control Account harus milik bisnis yang sama & tipe Asset.
export async function findValidControlAccount(businessId: string, controlAccountId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.id, controlAccountId),
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.category, 'Asset'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createBankAccount(
  businessId: string,
  data: {
    name: string;
    code?: string;
    controlAccountId: string;
    accountNumber?: string;
    openingBalance?: number;
    openingBalanceDate?: string;
    canHavePendingTransactions?: boolean;
    creditLimit?: number;
  },
) {
  const [row] = await db
    .insert(bankAccounts)
    .values({
      businessId,
      ...data,
      openingBalance: data.openingBalance?.toString(),
      creditLimit: data.creditLimit?.toString(),
    } as typeof bankAccounts.$inferInsert)
    .returning({ id: bankAccounts.id });
  return getBankAccountById(businessId, row.id);
}

export async function updateBankAccount(
  businessId: string,
  bankAccountId: string,
  data: Partial<{
    name: string;
    code: string;
    controlAccountId: string;
    accountNumber: string;
    openingBalance: number;
    openingBalanceDate: string;
    canHavePendingTransactions: boolean;
    creditLimit: number;
  }>,
) {
  const { openingBalance, creditLimit, ...rest } = data;
  const [row] = await db
    .update(bankAccounts)
    .set({
      ...rest,
      ...(openingBalance !== undefined ? { openingBalance: openingBalance.toString() } : {}),
      ...(creditLimit !== undefined ? { creditLimit: creditLimit.toString() } : {}),
      updatedAt: new Date(),
    } as Partial<typeof bankAccounts.$inferInsert>)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .returning({ id: bankAccounts.id });
  return row ? getBankAccountById(businessId, row.id) : null;
}

export async function setBankAccountActive(businessId: string, bankAccountId: string, isActive: boolean) {
  const [row] = await db
    .update(bankAccounts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .returning({ id: bankAccounts.id });
  return row ? getBankAccountById(businessId, row.id) : null;
}

// Hanya Admin (dijaga di route). Dipakai menurunkan/menghapus kunci secara manual.
export async function setBankAccountLockDate(businessId: string, bankAccountId: string, lockDate: string | null) {
  const [row] = await db
    .update(bankAccounts)
    .set({ lockDate })
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .returning({ id: bankAccounts.id });
  return row ? getBankAccountById(businessId, row.id) : null;
}

// §4.4 aturan #3: tidak boleh dihapus kalau Control Account-nya sudah
// dipakai transaksi. TIDAK bisa mengandalkan FK constraint biasa (journal_entry_lines
// menunjuk ke chart_of_accounts, bukan ke bank_accounts secara langsung) -
// jadi dicek eksplisit di sini.
export async function deleteBankAccount(businessId: string, bankAccountId: string) {
  const [account] = await db
    .select({ controlAccountId: bankAccounts.controlAccountId })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);

  if (!account) return { deleted: false, hasTransactions: false };

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.accountId, account.controlAccountId));

  if (Number(count) > 0) {
    return { deleted: false, hasTransactions: true };
  }

  await db.delete(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
  return { deleted: true, hasTransactions: false };
}