import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { Period, StatsResponse } from '@gam/types';
import { periodToDateRange, previousPeriodRange } from '../lib/period.js';
import { ok } from '../lib/responses.js';

interface TotalsRow {
  impressions: bigint | null;
  clicks: bigint | null;
  revenue: Prisma.Decimal | null;
}

async function totalsForRange(from: Date | null, to: Date | null): Promise<{
  totalImpressions: number;
  totalClicks: number;
  totalRevenue: number;
  avgEcpm: number;
  ctr: number;
}> {
  let where = Prisma.empty;
  if (from && to) {
    where = Prisma.sql`WHERE date BETWEEN ${from} AND ${to}`;
  } else if (to) {
    where = Prisma.sql`WHERE date <= ${to}`;
  }

  const rows = await prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(impressions), 0)::bigint AS impressions,
      COALESCE(SUM(clicks), 0)::bigint      AS clicks,
      COALESCE(SUM(revenue), 0)             AS revenue
    FROM gam_reports
    ${where}
  `);
  const row = rows[0] ?? { impressions: 0n, clicks: 0n, revenue: new Prisma.Decimal(0) };
  const impressions = Number(row.impressions ?? 0n);
  const clicks = Number(row.clicks ?? 0n);
  const revenue = Number(row.revenue ?? 0);
  const avgEcpm = impressions > 0 ? (revenue / impressions) * 1000 : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  return {
    totalImpressions: impressions,
    totalClicks: clicks,
    totalRevenue: revenue,
    avgEcpm,
    ctr,
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { period?: Period } }>(
    '/stats',
    {
      schema: {
        tags: ['reports'],
        summary: 'Summary KPIs for the selected period',
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '7d' },
          },
        },
      },
    },
    async (req) => {
      const period: Period = req.query.period ?? '7d';
      const { from, to } = periodToDateRange(period);
      const current = await totalsForRange(from, to);

      let previousPeriod: StatsResponse['previousPeriod'];
      if (period !== 'all') {
        const prev = previousPeriodRange(period);
        if (prev.from && prev.to) {
          const prevTotals = await totalsForRange(prev.from, prev.to);
          const pct = (cur: number, p: number) => (p > 0 ? ((cur - p) / p) * 100 : 0);
          previousPeriod = {
            totalRevenue: prevTotals.totalRevenue,
            totalImpressions: prevTotals.totalImpressions,
            avgEcpm: prevTotals.avgEcpm,
            changes: {
              revenuePct: pct(current.totalRevenue, prevTotals.totalRevenue),
              impressionsPct: pct(current.totalImpressions, prevTotals.totalImpressions),
              ecpmPct: pct(current.avgEcpm, prevTotals.avgEcpm),
            },
          };
        }
      }

      const data: StatsResponse = {
        period,
        ...current,
        ...(previousPeriod ? { previousPeriod } : {}),
      };
      return ok(data, period);
    },
  );
}
