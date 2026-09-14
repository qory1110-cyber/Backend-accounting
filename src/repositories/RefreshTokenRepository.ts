import { and, eq, isNull } from 'drizzle-orm';
import db from '../db/index.js';
import { refreshTokens } from '../db/schema.js';
import { hashRefreshToken, parseDurationMs } from '../libs/jwt.js';
import env from '../constants/env.js';

export async function createRefreshToken(userId: string, rawToken: string, userAgent?: string) {
  const expiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRES_IN));
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashRefreshToken(rawToken),
    expiresAt,
    userAgent,
  });
}

export async function findValidRefreshToken(rawToken: string) {
  const tokenHash = hashRefreshToken(rawToken);
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return row;
}

export async function revokeRefreshTokenById(id: string) {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id));
}

export async function revokeRefreshTokenByRawToken(rawToken: string) {
  const tokenHash = hashRefreshToken(rawToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
}

// Dipanggil saat ganti password — mencabut SEMUA sesi lain (§2.3.1 LAPORAN_FASE_1_2_Backend.docx)
export async function revokeAllRefreshTokensForUser(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
