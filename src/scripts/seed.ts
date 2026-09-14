import { eq } from 'drizzle-orm';
import db, { closePool } from '../db/index.js';
import { businesses, users, userBusinessRoles } from '../db/schema.js';
import { hashPassword } from '../libs/password.js';

async function main() {
  const passwordHash = await hashPassword('Password123!');

  let [user] = await db.select().from(users).where(eq(users.email, 'admin@example.com')).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ name: 'Admin Percobaan', email: 'admin@example.com', passwordHash })
      .returning();
  }

  const [business] = await db.insert(businesses).values({ name: 'Bisnis Percobaan' }).returning();

  await db.insert(userBusinessRoles).values({
    userId: user.id,
    businessId: business.id,
    role: 'admin',
    status: 'active',
  });

  console.log('Seed selesai. Login dengan:');
  console.log('  email    : admin@example.com');
  console.log('  password : Password123!');
  console.log(`  businessId: ${business.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
