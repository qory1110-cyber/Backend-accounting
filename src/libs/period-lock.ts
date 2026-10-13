import { and, eq, inArray } from 'drizzle-orm';
import db from '../db/index.js';
import { bankAccounts, businesses } from '../db/schema.js';

// Mengembalikan tanggal kunci yang berlaku BILA tanggal transaksi jatuh di periode
// terkunci; null kalau transaksi boleh dilanjutkan. Kunci yang berlaku = yang paling
// baru di antara lock global bisnis dan lock tiap bank yang terlibat.
// Boleh dipanggil dengan bankAccountIds kosong (hanya lock global yang dicek).
export async function findLockedUntil(
  businessId: string,
  bankAccountIds: string[],
  date: string,
): Promise<string | null> {
  const locks: string[] = [];

  const [business] = await db
    .select({ lockDate: businesses.lockDate })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (business?.lockDate) locks.push(business.lockDate);

  if (bankAccountIds.length > 0) {
    const rows = await db
      .select({ lockDate: bankAccounts.lockDate })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.businessId, businessId), inArray(bankAccounts.id, bankAccountIds)));
    for (const r of rows) if (r.lockDate) locks.push(r.lockDate);
  }

  if (locks.length === 0) return null;
  // Format YYYY-MM-DD, jadi perbandingan teks sama dengan perbandingan tanggal.
  const latest = locks.reduce((a, b) => (b > a ? b : a));
  return date <= latest ? latest : null;
}

// Dipakai transaksi yang barisnya berupa akun GL (mis. Journal Entries): akun yang
// merupakan Control Account sebuah bank dicek terhadap lock date bank itu, dan
// lock global bisnis selalu dicek untuk semua jurnal.
export async function findLockedUntilForAccounts(
  businessId: string,
  accountIds: string[],
  date: string,
): Promise<string | null> {
  const banks =
    accountIds.length === 0
      ? []
      : await db
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.businessId, businessId), inArray(bankAccounts.controlAccountId, accountIds)));
  return findLockedUntil(
    businessId,
    banks.map((b) => b.id),
    date,
  );
}

export function periodLockedMessage(lockedUntil: string, action: 'create' | 'delete' | 'void') {
  if (action === 'create') {
    return `Tanggal transaksi berada di periode yang sudah dikunci (sampai ${lockedUntil}). Gunakan tanggal setelah ${lockedUntil}`;
  }
  if (action === 'void') {
    return `Faktur berada di periode yang sudah dikunci (sampai ${lockedUntil}), sehingga tidak bisa di-void`;
  }
  return `Transaksi berada di periode yang sudah dikunci (sampai ${lockedUntil}), sehingga tidak bisa dihapus`;
}