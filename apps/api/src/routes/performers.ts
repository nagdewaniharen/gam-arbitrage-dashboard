import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { Dimension, PerformersResponse, PerformerRow, Period } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';
import { periodToDateRange } from '../lib/period.js';
import { dimColumn, isValidDimension } from '../lib/dim.js';
import { ok, err } from '../lib/responses.js';

interface RawPerformerRow {
  name: string | null;
  impressions: bigint;
  clicks: bigint;
  revenue: Prisma.Decimal;
}

export async function performersRoutes(app: FastifyInstance) {
  app.get<{
    Params: { type: string };
    Querystring: { period?: Period; by?: Dimension; limit?: number; minImpressions?: number };
  }>(
    '/performers/:type',
    {
      schema: {
        tags: ['reports'],
        summary: 'Top or bottom performers by eCPM',
        params: {
          type: 'object',
          required: ['type'],
          properties: { type: { type: 'string', enum: ['top', 'bottom'] } },
        },
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '7d' },
            by: { type: 'string', enum: [...VALID_DIMENSIONS], default: 'campaign' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
            minImpressions: { type: 'integer', minimum: 0, default: 10 },
          },
        },
      },
    },
    async (req, reply) => {
      const { type } = req.params;
      if (type !== 'top' && type !== 'bottom') {
        return reply.code(400).send(err('INVALID_TYPE', `type must be top|bottom`));
      }
      const by: Dimension = (req.query.by as Dimension) ?? 'campaign';
      if (!isValidDimension(by)) {
        return reply.code(400).send(err('INVALID_DIMENSION', `Bad by: ${by}`));
      }
      const period: Period = req.query.period ?? '7d';
      const limit = req.query.limit ?? 10;
      const minImpressions = req.query.minImpressions ?? 10;
      const { from, to } = periodToDateRange(period);
      const col = Prisma.raw(dimColumn(by));

      let where = Prisma.empty;
      if (from && to) where = Prisma.sql`WHERE date BETWEEN ${from} AND ${to}`;
      else if (to) where = Prisma.sql`WHERE date <= ${to}`;

      const orderDir = Prisma.raw(type === 'top' ? 'DESC' : 'ASC');

      const rows = await prisma.$queryRaw<RawPerformerRow[]>(Prisma.sql`
        SELECT
          ${col}::text                          AS name,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint      AS clicks,
          COALESCE(SUM(revenue), 0)             AS revenue
        FROM gam_reports
        ${where}
        GROUP BY ${col}
        HAVING COALESCE(SUM(impressions), 0) >= ${minImpressions}
        ORDER BY
          CASE WHEN SUM(impressions) > 0
            THEN (SUM(revenue) / SUM(impressions)) * 1000
            ELSE 0
          END ${orderDir}
        LIMIT ${limit}
      `);

      const mapped: PerformerRow[] = rows.map((r, idx) => {
        const impressions = Number(r.impressions);
        const clicks = Number(r.clicks);
        const revenue = Number(r.revenue);
        return {
          rank: idx + 1,
          name: r.name ?? '(empty)',
          impressions,
          clicks,
          revenue,
          ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
          ctr: impressions > 0 ? clicks / impressions : 0,
        };
      });

      const data: PerformersResponse = {
        period,
        by,
        type: type as 'top' | 'bottom',
        rows: mapped,
        minImpressions,
      };
      return ok(data, period);
    },
  );
}
