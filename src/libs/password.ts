import bcrypt from 'bcryptjs';
import env from '../constants/env.js';

// Bandingkan dengan versi sebelumnya (argon2) — dokumen boilerplate atasan
// menetapkan bcryptjs sebagai standar, jadi kita ikuti supaya konsisten
// dengan project referensi lain di perusahaan.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
