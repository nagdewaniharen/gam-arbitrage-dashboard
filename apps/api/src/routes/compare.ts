/**
 * Date-range comparison endpoint — `this week vs last week` style.
 * Two windows: [a.from, a.to] vs [b.from, b.to], returns aggregates for each.
 */
import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import { parseSites, whereGam } from '../lib/filters.js';
import { ok, err } from '../lib/responses.js';

interface CompareTotals {
  impressions: bigint | null;
  clicks: bigint | null;
  revenue: Prisma.Decimal | null;
}

async function aggregate(from: Date, to: Date, sites: string[]) {
  const where = whereGam({ from, to, sites });
  const rows = await prisma.$queryRaw<CompareTotals[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(impressions), 0)::bigint AS impressions,
      COALESCE(SUM(clicks), 0)::bigint      AS clicks,
      COALESCE(SUM(revenue), 0)             AS revenue
    FROM gam_reports
    ${where}
  `);
  const r = rows[0] ?? { impressions: 0n, clicks: 0n, revenue: new Prisma.Decimal(0) };
  const impressions = Number(r.impressions ?? 0n);
  const clicks = Number(r.clicks ?? 0n);
  const revenue = Number(r.revenue ?? 0);
  return {
    impressions,
    clicks,
    revenue,
    ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

export async function compareRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { fromA: string; toA: string; fromB: string; toB: string; sites?: string };
  }>(
    '/compare',
    {
      schema: {
        tags: ['reports'],
        summary: 'Compare two date ranges (e.g. this week vs last week)',
        querystring: {
          type: 'object',
          required: ['fromA', 'toA', 'fromB', 'toB'],
          properties: {
            fromA: { type: 'string', format: 'date' },
            toA: { type: 'string', format: 'date' },
            fromB: { type: 'string', format: 'date' },
            toB: { type: 'string', format: 'date' },
            sites: { type: 'string', description: 'Comma-separated site domains to filter by' },
          },
        },
      },
    },
    async (req, reply) => {
      const fromA = new Date(req.query.fromA);
      const toA = new Date(req.query.toA);
      const fromB = new Date(req.query.fromB);
      const toB = new Date(req.query.toB);
      if ([fromA, toA, fromB, toB].some((d) => isNaN(d.getTime()))) {
        return reply.code(400).send(err('INVALID_DATE', 'fromA/toA/fromB/toB must be YYYY-MM-DD'));
      }
      const sites = parseSites(req.query.sites);
      const [a, b] = await Promise.all([aggregate(fromA, toA, sites), aggregate(fromB, toB, sites)]);
      const change = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : 0);
      return ok({
        a: { from: req.query.fromA, to: req.query.toA, ...a },
        b: { from: req.query.fromB, to: req.query.toB, ...b },
        changes: {
          revenuePct: change(a.revenue, b.revenue),
          impressionsPct: change(a.impressions, b.impressions),
          ecpmPct: change(a.ecpm, b.ecpm),
          clicksPct: change(a.clicks, b.clicks),
        },
      });
    },
  );
}
