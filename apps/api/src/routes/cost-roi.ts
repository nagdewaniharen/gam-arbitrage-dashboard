import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { Period } from '@gam/types';
import { resolveDateRange } from '../lib/period.js';
import { ok } from '../lib/responses.js';

interface CostRoiRow {
  campaign: string;
  source: string;
  revenue: number;
  spend: number;
  profit: number;
  roiPct: number;
  roas: number;
  impressions: number;
  clicks: number;
}

interface RawJoinRow {
  campaign: string | null;
  source: string | null;
  revenue: Prisma.Decimal | null;
  spend: Prisma.Decimal | null;
  impressions: bigint | null;
  clicks: bigint | null;
}

export async function costRoiRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { period?: Period; from?: string; to?: string; limit?: number } }>(
    '/cost-roi',
    {
      schema: {
        tags: ['reports'],
        summary: 'Per-campaign profit / ROI / ROAS table — joins gam_reports with ad_spend',
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '30d' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const period: Period = req.query.period ?? '30d';
      const limit = req.query.limit ?? 50;
      const { from, to } = resolveDateRange(req.query);

      let dateClause = Prisma.empty;
      if (from && to) dateClause = Prisma.sql`AND date BETWEEN ${from} AND ${to}`;
      else if (to) dateClause = Prisma.sql`AND date <= ${to}`;

      // FULL OUTER JOIN of revenue + spend, grouped by campaign+source.
      const rows = await prisma.$queryRaw<RawJoinRow[]>(Prisma.sql`
        WITH rev AS (
          SELECT campaign, source,
                 COALESCE(SUM(revenue), 0) AS revenue,
                 COALESCE(SUM(impressions), 0)::bigint AS impressions,
                 COALESCE(SUM(clicks), 0)::bigint AS clicks
          FROM gam_reports
          WHERE 1=1 ${dateClause}
          GROUP BY campaign, source
        ),
        spd AS (
          SELECT campaign, source,
                 COALESCE(SUM(spend), 0) AS spend
          FROM ad_spend
          WHERE 1=1 ${dateClause}
          GROUP BY campaign, source
        )
        SELECT
          COALESCE(rev.campaign, spd.campaign) AS campaign,
          COALESCE(rev.source, spd.source)     AS source,
          COALESCE(rev.revenue, 0)             AS revenue,
          COALESCE(spd.spend, 0)               AS spend,
          COALESCE(rev.impressions, 0)         AS impressions,
          COALESCE(rev.clicks, 0)              AS clicks
        FROM rev
        FULL OUTER JOIN spd
          ON rev.campaign = spd.campaign AND rev.source = spd.source
        ORDER BY (COALESCE(rev.revenue, 0) - COALESCE(spd.spend, 0)) DESC
        LIMIT ${limit}
      `);

      const data: CostRoiRow[] = rows.map((r) => {
        const revenue = Number(r.revenue ?? 0);
        const spend = Number(r.spend ?? 0);
        const profit = revenue - spend;
        const roiPct = spend > 0 ? (profit / spend) * 100 : 0;
        const roas = spend > 0 ? revenue / spend : 0;
        return {
          campaign: r.campaign ?? '(empty)',
          source: r.source ?? '(empty)',
          revenue,
          spend,
          profit,
          roiPct,
          roas,
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
        };
      });

      const totals = data.reduce(
        (acc, r) => {
          acc.revenue += r.revenue;
          acc.spend += r.spend;
          return acc;
        },
        { revenue: 0, spend: 0 },
      );
      const totalProfit = totals.revenue - totals.spend;
      const totalRoiPct = totals.spend > 0 ? (totalProfit / totals.spend) * 100 : 0;
      const totalRoas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

      return ok(
        {
          period,
          rows: data,
          totals: {
            revenue: totals.revenue,
            spend: totals.spend,
            profit: totalProfit,
            roiPct: totalRoiPct,
            roas: totalRoas,
          },
        },
        period,
      );
    },
  );
}
