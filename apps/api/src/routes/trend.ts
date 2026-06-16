import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { Period, TrendPoint, TrendResponse } from '@gam/types';
import { periodToDateRange } from '../lib/period.js';
import { ok } from '../lib/responses.js';

interface RawTrend {
  date: Date;
  impressions: bigint;
  clicks: bigint;
  revenue: Prisma.Decimal;
}

export async function trendRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { period?: Period } }>(
    '/trend',
    {
      schema: {
        tags: ['reports'],
        summary: 'Daily revenue trend for the selected period',
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '30d' },
          },
        },
      },
    },
    async (req) => {
      const period: Period = req.query.period ?? '30d';
      const { from, to } = periodToDateRange(period);

      let where = Prisma.empty;
      if (from && to) where = Prisma.sql`WHERE date BETWEEN ${from} AND ${to}`;
      else if (to) where = Prisma.sql`WHERE date <= ${to}`;

      const rows = await prisma.$queryRaw<RawTrend[]>(Prisma.sql`
        SELECT
          date,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint      AS clicks,
          COALESCE(SUM(revenue), 0)             AS revenue
        FROM gam_reports
        ${where}
        GROUP BY date
        ORDER BY date ASC
      `);

      const points: TrendPoint[] = rows.map((r) => {
        const impressions = Number(r.impressions);
        const clicks = Number(r.clicks);
        const revenue = Number(r.revenue);
        return {
          date: r.date.toISOString().slice(0, 10),
          impressions,
          clicks,
          revenue,
          ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
        };
      });

      const data: TrendResponse = { period, points };
      return ok(data, period);
    },
  );
}
