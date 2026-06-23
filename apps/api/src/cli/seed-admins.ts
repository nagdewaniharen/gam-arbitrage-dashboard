/**
 * One-shot: pre-seed Workspace admins so they land as admin on first SSO.
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/seed-admins.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

import { prisma } from '@gam/db';

const ADMINS = [
  'haren@knnsyndicate.com',
  'aman@knnsyndicate.com',
  'khuswant@knnsyndicate.com',
];

async function main() {
  for (const email of ADMINS) {
    const u = await prisma.user.upsert({
      where: { email },
      create: { email, role: 'admin', isActive: true },
      update: { role: 'admin', isActive: true },
    });
    console.log(`✓ ${u.email}  role=${u.role}  active=${u.isActive}  created=${u.createdAt.toISOString()}`);
  }
  console.log('\nDone. They will be admin on first sign-in.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
