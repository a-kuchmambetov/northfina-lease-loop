// Fills the database from the data pack. Run by `npm run db:setup` (via `prisma db seed`).
// Safe to run again: it only adds assets that are missing and never overwrites your changes.
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { createPrismaClient } from '@/server/prisma-client';
import { seedAccounts } from './seed-accounts';

const db = createPrismaClient();
try {
  const assets = await seedAssets(db, await loadAssets());
  console.log(`🌱 Seeded ${assets.created} new assets (${assets.skipped} were already there).`);
  const customers = await seedCustomers(db, await loadCustomers());
  console.log(
    `🌱 Seeded ${customers.created} new customers (${customers.skipped} were already there).`
  );
  for (const account of await seedAccounts(db)) {
    console.log(`Test login: ${account.email} / ${account.password}`);
  }
} finally {
  await db.$disconnect();
}
