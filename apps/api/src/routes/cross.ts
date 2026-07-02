import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import type { CrossResponse, CrossRow, Dimension, Period } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';
import { resolveDateRange } from '../lib/period.js';
import { parseCountries, parseSites, whereGam } from '../lib/filters.js';
import { dimColumn, isValidDimension } from '../lib/dim.js';
import { ok, err } from '../lib/responses.js';

interface RawCrossRow {
  dim1: string | null;
  dim2: string | null;
  impressions: bigint;
  clicks: bigint;
  revenue: Prisma.Decimal;
}

export async function crossRoutes(app: FastifyInstance) {
  app.get<{
    Params: { dim1: string; dim2: string };
    Querystring: { period?: Period; from?: string; to?: string; limit?: number; sites?: string; countries?: string };
  }>(
    '/cross/:dim1/:dim2',
    {
      schema: {
        tags: ['reports'],
        summary: 'Cross-dimensional analysis (every dim1 × dim2 combination)',
        params: {
          type: 'object',
          required: ['dim1', 'dim2'],
          properties: {
            dim1: { type: 'string', enum: [...VALID_DIMENSIONS] },
            dim2: { type: 'string', enum: [...VALID_DIMENSIONS] },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['today', '7d', '30d', 'all'], default: '7d' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
            sites: { type: 'string', description: 'Comma-separated site domains to filter by' },
            countries: { type: 'string', description: 'Comma-separated country names to filter by' },
          },
        },
      },
    },
    async (req, reply) => {
      const { dim1, dim2 } = req.params;
      if (!isValidDimension(dim1) || !isValidDimension(dim2)) {
        return reply
          .code(400)
          .send(err('INVALID_DIMENSION', `Bad dimensions: ${dim1}, ${dim2}`));
      }
      if (dim1 === dim2) {
        return reply.code(400).send(err('SAME_DIMENSION', 'dim1 and dim2 must differ'));
      }
      const period: Period = req.query.period ?? '7d';
      const limit = req.query.limit ?? 200;
      const { from, to } = resolveDateRange(req.query);
      const sites = parseSites(req.query.sites);
      const countries = parseCountries(req.query.countries);
      const c1 = Prisma.raw(dimColumn(dim1 as Dimension));
      const c2 = Prisma.raw(dimColumn(dim2 as Dimension));

      const where = whereGam({ from, to, sites, countries });

      const rows = await prisma.$queryRaw<RawCrossRow[]>(Prisma.sql`
        SELECT
          ${c1}::text                           AS dim1,
          ${c2}::text                           AS dim2,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint      AS clicks,
          COALESCE(SUM(revenue), 0)             AS revenue
        FROM gam_reports
        ${where}
        GROUP BY ${c1}, ${c2}
        ORDER BY revenue DESC
        LIMIT ${limit}
      `);

      const mapped: CrossRow[] = rows.map((r) => {
        const impressions = Number(r.impressions);
        const clicks = Number(r.clicks);
        const revenue = Number(r.revenue);
        return {
          dim1: r.dim1 ?? '(empty)',
          dim2: r.dim2 ?? '(empty)',
          impressions,
          clicks,
          revenue,
          ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
          ctr: impressions > 0 ? clicks / impressions : 0,
        };
      });

      const data: CrossResponse = {
        period,
        dim1: dim1 as Dimension,
        dim2: dim2 as Dimension,
        rows: mapped,
      };
      return ok(data, period);
    },
  );
}
