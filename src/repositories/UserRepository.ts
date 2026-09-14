import { eq } from 'drizzle-orm';
import db from '../db/index.js';
import { users } from '../db/schema.js';

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function createUser(data: { name: string; email: string; passwordHash: string }) {
  const [user] = await db.insert(users).values(data).returning();
  return user;
}

export async function updateUserProfile(id: string, data: { name?: string }) {
  const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  return user ?? null;
}

export async function updateUserPassword(id: string, passwordHash: string) {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}
