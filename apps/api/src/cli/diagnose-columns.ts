/**
 * Diagnostic: calls runGamReport twice for the same date with both column
 * families (AD_EXCHANGE_* vs TOTAL_LINE_ITEM_LEVEL_*) and dumps the results
 * side by side. Used to verify which family matches the GAM UI dashboard.
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/diagnose-columns.ts [YYYY-MM-DD]
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

import { runGamReport, type ParsedReportRow } from '../services/gam-client.js';

const logger = {
  info: (m: string, e?: unknown) => console.log('[info]', m, e ?? ''),
  warn: (m: string, e?: unknown) => console.log('[warn]', m, e ?? ''),
  error: (m: string, e?: unknown) => console.log('[error]', m, e ?? ''),
};

function summarize(label: string, rows: ParsedReportRow[]) {
  const totals = {
    impressions: rows.reduce((s, r) => s + Number(r.impressions), 0),
    clicks: rows.reduce((s, r) => s + Number(r.clicks), 0),
    revenue: rows.reduce((s, r) => s + Number(r.revenue), 0),
  };
  console.log(`\n${'='.repeat(80)}\n[${label}]\n${'='.repeat(80)}`);
  console.log(`rows: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.adUnit.padEnd(45)}  imp=${String(r.impressions).padStart(6)}  rev=$${r.revenue.toFixed(4)}  ecpm=$${r.ecpm.toFixed(2)}`,
    );
  }
  console.log(
    `  TOTALS: impressions=${totals.impressions}  clicks=${totals.clicks}  revenue=$${totals.revenue.toFixed(2)}`,
  );
  return totals;
}

async function main() {
  const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const [y, m, d] = dateArg.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  console.log(`Diagnostic for ${dateArg} (network ${process.env.GAM_NETWORK_CODE})\n`);

  const adxRows = await runGamReport(
    { fromDate: date, toDate: date, columnFamily: 'ad_exchange' },
    logger,
  );
  const adxTotals = summarize('A: AD_EXCHANGE_* (current production)', adxRows);

  const totalRows = await runGamReport(
    { fromDate: date, toDate: date, columnFamily: 'total_line_item_level' },
    logger,
  );
  const totalTotals = summarize('B: TOTAL_LINE_ITEM_LEVEL_* (all programmatic)', totalRows);

  console.log(`\n${'='.repeat(80)}\nVERDICT\n${'='.repeat(80)}`);
  console.log(`AD_EXCHANGE_*           revenue: $${adxTotals.revenue.toFixed(2)}  impressions: ${adxTotals.impressions}`);
  console.log(`TOTAL_LINE_ITEM_LEVEL_* revenue: $${totalTotals.revenue.toFixed(2)}  impressions: ${totalTotals.impressions}`);
  console.log(
    `\nIf TOTAL > AD_EXCHANGE, the missing data is in non-AdX channels (Preferred Deals, Programmatic Guaranteed, direct). Switch the production cron to TOTAL_LINE_ITEM_LEVEL_* to match the GAM UI.`,
  );
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
