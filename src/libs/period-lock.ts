import { inArray } from 'drizzle-orm';
import db from '../db/index.js';
import { bankAccounts } from '../db/schema.js';

// Mengembalikan lockDate terbesar milik bank-bank yang terlibat BILA tanggal
// transaksi jatuh di periode terkunci; null kalau transaksi boleh dilanjutkan.
export async function findLockedUntil(bankAccountIds: string[], date: string): Promise<string | null> {
  const rows = await db
    .select({ lockDate: bankAccounts.lockDate })
    .from(bankAccounts)
    .where(inArray(bankAccounts.id, bankAccountIds));

  let lockedUntil: string | null = null;
  for (const r of rows) {
    // Format YYYY-MM-DD, jadi perbandingan teks sama dengan perbandingan tanggal.
    if (r.lockDate && date <= r.lockDate && (!lockedUntil || r.lockDate > lockedUntil)) {
      lockedUntil = r.lockDate;
    }
  }
  return lockedUntil;
}

export function periodLockedMessage(lockedUntil: string, action: 'create' | 'delete') {
  return action === 'create'
    ? `Tanggal transaksi berada di periode yang sudah direkonsiliasi dan dikunci (sampai ${lockedUntil}). Gunakan tanggal setelah ${lockedUntil}`
    : `Transaksi berada di periode yang sudah direkonsiliasi dan dikunci (sampai ${lockedUntil}), sehingga tidak bisa dihapus`;
}