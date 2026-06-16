/**
 * Alert rule engine — evaluates every active rule against the latest data
 * and posts a Slack alert if the rule's condition is met.
 *
 * Supported rules (initial set):
 *   - ecpm.drop_pct_vs_7d_avg   metric=ecpm    threshold=20 (=20%)
 *   - revenue.drop_pct_vs_7d_avg metric=revenue threshold=30
 *   - match_rate.below_absolute  metric=match_rate threshold=0.70
 */
import { prisma, Prisma } from '@gam/db';
import { postSlackAlert } from './slack-notifier.js';

export async function evaluateAlerts(log: {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}): Promise<{ fired: number; evaluated: number }> {
  const rules = await prisma.alertRule.findMany({ where: { isEnabled: true } });
  let fired = 0;

  for (const rule of rules) {
    try {
      const triggered = await checkRule(rule);
      const event = await prisma.alertEvent.create({
        data: {
          ruleId: rule.id,
          triggered,
          ...(triggered ? { context: { firedAt: new Date().toISOString() } } : {}),
        },
      });
      if (triggered) {
        fired++;
        await postSlackAlert(
          {
            title: `🚨 ${rule.name}`,
            text: `Rule \`${rule.metric} ${rule.comparison}\` exceeded threshold ${rule.threshold}.`,
            level: 'critical',
            fields: [
              { label: 'Metric', value: rule.metric },
              { label: 'Comparison', value: rule.comparison },
              { label: 'Threshold', value: rule.threshold.toString() },
              { label: 'Event ID', value: event.id.toString() },
            ],
          },
          log,
        );
      }
    } catch (e) {
      log.error(`Failed to evaluate rule ${rule.id}`, e);
    }
  }
  return { fired, evaluated: rules.length };
}

async function checkRule(rule: { metric: string; comparison: string; threshold: Prisma.Decimal }): Promise<boolean> {
  const threshold = Number(rule.threshold);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  if (rule.comparison === 'drop_pct_vs_7d_avg') {
    const [todayTotals, baselineTotals] = await Promise.all([
      totals(today, today, rule.metric),
      totals(sevenDaysAgo, today, rule.metric),
    ]);
    const baselineAvg = baselineTotals.value / 7;
    if (baselineAvg <= 0) return false;
    const dropPct = ((baselineAvg - todayTotals.value) / baselineAvg) * 100;
    return dropPct >= threshold;
  }
  if (rule.comparison === 'below_absolute') {
    const t = await totals(today, today, rule.metric);
    return t.value < threshold;
  }
  return false;
}

async function totals(from: Date, to: Date, metric: string): Promise<{ value: number }> {
  if (metric === 'revenue') {
    const r = await prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(revenue), 0) AS v FROM gam_reports WHERE date BETWEEN ${from} AND ${to}
    `);
    return { value: Number(r[0]?.v ?? 0) };
  }
  if (metric === 'ecpm') {
    const r = await prisma.$queryRaw<{ rev: Prisma.Decimal | null; impr: bigint | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(revenue), 0) AS rev, COALESCE(SUM(impressions), 0)::bigint AS impr
      FROM gam_reports WHERE date BETWEEN ${from} AND ${to}
    `);
    const rev = Number(r[0]?.rev ?? 0);
    const impr = Number(r[0]?.impr ?? 0n);
    return { value: impr > 0 ? (rev / impr) * 1000 : 0 };
  }
  if (metric === 'match_rate') {
    const r = await prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(AVG(match_rate), 0) AS v FROM gam_reports WHERE date BETWEEN ${from} AND ${to}
    `);
    return { value: Number(r[0]?.v ?? 0) };
  }
  return { value: 0 };
}
