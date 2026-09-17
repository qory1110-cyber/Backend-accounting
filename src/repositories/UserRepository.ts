import { eq } from 'drizzle-orm';
import db from '../db/index.js';
import { users } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
import { userBusinessRoles } from '../db/schema.js';

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

export async function listUsersSharingBusiness(currentUserId: string) {
  const myBusinesses = await db
    .select({ businessId: userBusinessRoles.businessId })
    .from(userBusinessRoles)
    .where(eq(userBusinessRoles.userId, currentUserId))

  const businessIds = myBusinesses.map((b) => b.businessId)
  if (businessIds.length === 0) return []

  return db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(userBusinessRoles, eq(userBusinessRoles.userId, users.id))
    .where(inArray(userBusinessRoles.businessId, businessIds))
}