/**
 * One-shot CLI for the initial 90-day backfill (or any custom window).
 * Usage:
 *   pnpm --filter @gam/api exec tsx src/cli/backfill.ts            # 90-day backfill
 *   pnpm --filter @gam/api exec tsx src/cli/backfill.ts --days 30  # last 30 days
 */
import { env } from '../config/env.js';
import { runRefresh } from '../services/gam-runner.js';

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const daysBack = daysIdx >= 0 ? Number(args[daysIdx + 1]) : env.GAM_BACKFILL_DAYS_ON_FIRST_RUN;
  console.log(`[backfill] running for last ${daysBack} days`);
  const log = {
    info: (m: string, e?: unknown) => console.log('  i', m, e ?? ''),
    warn: (m: string, e?: unknown) => console.warn('  ⚠', m, e ?? ''),
    error: (m: string, e?: unknown) => console.error('  ✗', m, e ?? ''),
  };
  const result = await runRefresh({ daysBack, trigger: 'cli-backfill' }, log);
  console.log('\n[backfill] result:', result);
  process.exit(result.status === 'succeeded' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
