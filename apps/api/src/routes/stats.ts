import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { Period, StatsResponse } from '@gam/types';
import { previousPeriodRange, resolveDateRange } from '../lib/period.js';
import { parseSites, whereGam } from '../lib/filters.js';
import { ok } from '../lib/responses.js';

interface TotalsRow {
  impressions: bigint | null;
  clicks: bigint | null;
  revenue: Prisma.Decimal | null;
  viewability: Prisma.Decimal | null;
  match_rate: Prisma.Decimal | null;
}

async function totalsForRange(from: Date | null, to: Date | null, sites: string[] = []): Promise<{
  totalImpressions: number;
  totalClicks: number;
  totalRevenue: number;
  avgEcpm: number;
  ctr: number;
  viewability: number;
  matchRate: number;
}> {
  const where = whereGam({ from, to, sites });

  const rows = await prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(impressions), 0)::bigint AS impressions,
      COALESCE(SUM(clicks), 0)::bigint      AS clicks,
      COALESCE(SUM(revenue), 0)             AS revenue,
      COALESCE(SUM(viewability * impressions) / NULLIF(SUM(impressions), 0), 0) AS viewability,
      COALESCE(SUM(match_rate  * impressions) / NULLIF(SUM(impressions), 0), 0) AS match_rate
    FROM gam_reports
    ${where}
  `);
  const row = rows[0] ?? { impressions: 0n, clicks: 0n, revenue: new Prisma.Decimal(0), viewability: new Prisma.Decimal(0), match_rate: new Prisma.Decimal(0) };
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
    viewability: Number(row.viewability ?? 0),
    matchRate: Number(row.match_rate ?? 0),
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { period?: Period; from?: string; to?: string; sites?: string } }>(
    '/stats',
    {
      schema: {
        tags: ['reports'],
        summary: 'Summary KPIs for the selected period (or custom from/to)',
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '7d' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            sites: { type: 'string', description: 'Comma-separated site domains to filter by' },
          },
        },
      },
    },
    async (req) => {
      const period: Period = req.query.period ?? '7d';
      const { from, to, isCustom } = resolveDateRange(req.query);
      const sites = parseSites(req.query.sites);
      const current = await totalsForRange(from, to, sites);

      let previousPeriod: StatsResponse['previousPeriod'];
      if (!isCustom && period !== 'all') {
        const prev = previousPeriodRange(period);
        if (prev.from && prev.to) {
          const prevTotals = await totalsForRange(prev.from, prev.to, sites);
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
