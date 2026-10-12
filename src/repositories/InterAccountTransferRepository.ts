import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db/index.js';
import { interAccountTransfers, bankAccounts, journalEntries, journalEntryLines } from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

async function getBankInfo(businessId: string, bankAccountId: string) {
  const [row] = await db
    .select({
      id: bankAccounts.id,
      controlAccountId: bankAccounts.controlAccountId,
      canHavePendingTransactions: bankAccounts.canHavePendingTransactions,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

async function attachDetail(transfer: typeof interAccountTransfers.$inferSelect) {
  const banks = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name })
    .from(bankAccounts)
    .where(inArray(bankAccounts.id, [transfer.paidFromBankAccountId, transfer.receivedInBankAccountId]));
  const nameOf = (id: string) => banks.find((b) => b.id === id)?.name ?? '';

  return {
    ...transfer,
    amount: Number(transfer.amount),
    paidFromBankAccountName: nameOf(transfer.paidFromBankAccountId),
    receivedInBankAccountName: nameOf(transfer.receivedInBankAccountId),
  };
}

export async function listTransfers(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(interAccountTransfers)
    .where(eq(interAccountTransfers.businessId, businessId));

  const rows = await db
    .select()
    .from(interAccountTransfers)
    .where(eq(interAccountTransfers.businessId, businessId))
    .orderBy(interAccountTransfers.transferDate, interAccountTransfers.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachDetail));
  return { data, total: Number(count) };
}

export async function getTransferById(businessId: string, transferId: string) {
  const [row] = await db
    .select()
    .from(interAccountTransfers)
    .where(and(eq(interAccountTransfers.id, transferId), eq(interAccountTransfers.businessId, businessId)))
    .limit(1);
  return row ? attachDetail(row) : null;
}

export async function createTransfer(
  businessId: string,
  data: {
    transferDate: string;
    reference?: string;
    description?: string;
    paidFromBankAccountId: string;
    receivedInBankAccountId: string;
    amount: number;
  },
) {
  if (data.paidFromBankAccountId === data.receivedInBankAccountId) {
    return { result: null, error: 'SAME_ACCOUNT' as const };
  }

  const paidFrom = await getBankInfo(businessId, data.paidFromBankAccountId);
  const receivedIn = await getBankInfo(businessId, data.receivedInBankAccountId);
  if (!paidFrom || !receivedIn) return { result: null, error: 'INVALID_BANK_ACCOUNT' as const };
  const lockedUntil = await findLockedUntil([data.paidFromBankAccountId, data.receivedInBankAccountId], data.transferDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  const reference = data.reference?.trim() || `TRF-${Date.now()}`;
  // Cleared otomatis true untuk sisi yang bank-nya tidak memakai pending
  // transactions, sama seperti pada Payments.
  const paidFromCleared = !paidFrom.canHavePendingTransactions;
  const receivedInCleared = !receivedIn.canHavePendingTransactions;

  const id = await db.transaction(async (tx) => {
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: data.transferDate,
        sourceModule: 'inter_account_transfer',
        description: reference,
      })
      .returning();

    // Debit akun tujuan, Credit akun asal. Tanpa kontak, dan tidak menyentuh
    // akun Income/Expense sehingga tidak memengaruhi Laba Rugi.
    await tx.insert(journalEntryLines).values([
      {
        journalEntryId: journalEntry.id,
        accountId: receivedIn.controlAccountId,
        debit: data.amount.toString(),
        credit: '0.00',
      },
      {
        journalEntryId: journalEntry.id,
        accountId: paidFrom.controlAccountId,
        debit: '0.00',
        credit: data.amount.toString(),
      },
    ]);

    const [transfer] = await tx
      .insert(interAccountTransfers)
      .values({
        businessId,
        transferDate: data.transferDate,
        reference,
        description: data.description,
        paidFromBankAccountId: data.paidFromBankAccountId,
        receivedInBankAccountId: data.receivedInBankAccountId,
        amount: data.amount.toString(),
        paidFromCleared,
        receivedInCleared,
        journalEntryId: journalEntry.id,
      })
      .returning();

    return transfer.id;
  });

  return { result: await getTransferById(businessId, id), error: null };
}

export async function setTransferCleared(
  businessId: string,
  transferId: string,
  patch: { paidFromCleared?: boolean; receivedInCleared?: boolean },
) {
  const values: Partial<typeof interAccountTransfers.$inferInsert> = {};
  if (patch.paidFromCleared !== undefined) values.paidFromCleared = patch.paidFromCleared;
  if (patch.receivedInCleared !== undefined) values.receivedInCleared = patch.receivedInCleared;

  const [row] = await db
    .update(interAccountTransfers)
    .set(values)
    .where(and(eq(interAccountTransfers.id, transferId), eq(interAccountTransfers.businessId, businessId)))
    .returning();
  return row ? getTransferById(businessId, transferId) : null;
}

// Tidak ada edit. Hapus memposting jurnal pembalik, baru menghapus baris header.
export async function deleteTransfer(businessId: string, transferId: string) {
  const transfer = await getTransferById(businessId, transferId);
  if (!transfer) return { deleted: false, lockedUntil: null };
  const lockedUntil = await findLockedUntil([transfer.paidFromBankAccountId, transfer.receivedInBankAccountId], transfer.transferDate);
  if (lockedUntil) return { deleted: false, lockedUntil };

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, transfer.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceModule: 'inter_account_transfer_void',
        sourceId: transfer.id,
        description: `Pembalik transfer ${transfer.reference}`,
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

    await tx.delete(interAccountTransfers).where(eq(interAccountTransfers.id, transferId));
  });

  return { deleted: true, lockedUntil: null };
}