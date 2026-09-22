// Kode error PostgreSQL untuk pelanggaran UNIQUE constraint.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_UNIQUE_VIOLATION = '23505';

export function isPgUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const err = error as { code?: string; cause?: { code?: string } };

  // Drizzle membungkus error asli PostgreSQL di dalam `.cause` -
  // kode 23505 ada di situ, bukan di objek error paling luar.
  return err.code === PG_UNIQUE_VIOLATION || err.cause?.code === PG_UNIQUE_VIOLATION;
}

// Jangan pernah mengembalikan error.message mentah dari driver database ke
// client — bisa membocorkan nama tabel/kolom internal. Dipakai di route
// sebagai fallback pesan generik untuk error yang tidak dikenali.
export function safeErrorMessage(error: unknown, fallback = 'Terjadi kesalahan'): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

const PG_FOREIGN_KEY_VIOLATION = '23503';

// Dipakai untuk DELETE yang harus ditolak kalau data masih direferensikan
// tabel lain (mis. customer yang sudah pernah dipakai di journal_entry_lines).
export function isPgForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === PG_FOREIGN_KEY_VIOLATION || err.cause?.code === PG_FOREIGN_KEY_VIOLATION;
}