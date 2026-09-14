import jwt, { type SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import env from '../constants/env.js';

export interface AccessTokenPayload {
  sub: string; // user id
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.JWT_SECRET, options);
}

// Dukung rotasi JWT_SECRET tanpa downtime (§8.3): coba secret aktif dulu,
// baru secret lama kalau ada dan yang baru gagal — token lama tetap valid
// sampai masa berlakunya habis.
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  } catch (err) {
    if (env.JWT_SECRET_OLD) {
      return jwt.verify(token, env.JWT_SECRET_OLD) as AccessTokenPayload;
    }
    throw err;
  }
}

// Refresh token BUKAN JWT — string acak biasa, disimpan sebagai hash di
// database (tabel refresh_tokens) supaya bisa dicabut sewaktu-waktu.
// JWT untuk refresh token tidak masuk akal karena JWT itu sendiri baru bisa
// "dicabut" dengan menyimpan daftar hitam — ujung-ujungnya tetap butuh tabel.
export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseDurationMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return value * unitMs;
}
