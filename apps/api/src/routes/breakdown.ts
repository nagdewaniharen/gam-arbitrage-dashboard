import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { BreakdownResponse, BreakdownRow, Dimension, Period } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';
import { resolveDateRange } from '../lib/period.js';
import { dimColumn, isValidDimension } from '../lib/dim.js';
import { ok, err } from '../lib/responses.js';

interface RawRow {
  name: string | null;
  impressions: bigint;
  clicks: bigint;
  revenue: Prisma.Decimal;
}

export async function breakdownRoutes(app: FastifyInstance) {
  app.get<{
    Params: { dimension: string };
    Querystring: { period?: Period; from?: string; to?: string; limit?: number };
  }>(
    '/breakdown/:dimension',
    {
      schema: {
        tags: ['reports'],
        summary: 'Revenue breakdown by a single dimension',
        params: {
          type: 'object',
          required: ['dimension'],
          properties: { dimension: { type: 'string', enum: [...VALID_DIMENSIONS] } },
        },
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '7d' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const { dimension } = req.params;
      if (!isValidDimension(dimension)) {
        return reply.code(400).send(err('INVALID_DIMENSION', `Unknown dimension: ${dimension}`));
      }
      const period: Period = req.query.period ?? '7d';
      const limit = req.query.limit ?? 50;
      const { from, to } = resolveDateRange(req.query);
      const col = Prisma.raw(dimColumn(dimension as Dimension));

      let where = Prisma.empty;
      if (from && to) where = Prisma.sql`WHERE date BETWEEN ${from} AND ${to}`;
      else if (to) where = Prisma.sql`WHERE date <= ${to}`;

      const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          ${col}::text                          AS name,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint      AS clicks,
          COALESCE(SUM(revenue), 0)             AS revenue
        FROM gam_reports
        ${where}
        GROUP BY ${col}
        ORDER BY revenue DESC
        LIMIT ${limit}
      `);

      const mapped: BreakdownRow[] = rows.map((r) => {
        const impressions = Number(r.impressions ?? 0n);
        const clicks = Number(r.clicks ?? 0n);
        const revenue = Number(r.revenue ?? 0);
        return {
          name: r.name ?? '(empty)',
          impressions,
          clicks,
          revenue,
          ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
          ctr: impressions > 0 ? clicks / impressions : 0,
        };
      });

      const data: BreakdownResponse = {
        period,
        dimension: dimension as Dimension,
        rows: mapped,
      };
      return ok(data, period);
    },
  );
}
