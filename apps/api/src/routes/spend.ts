import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import { env } from '../config/env.js';
import { ok, err } from '../lib/responses.js';

interface SpendBody {
  date: string; // YYYY-MM-DD
  campaign: string;
  source: string;
  spend: number;
  clicks?: number;
  impressions?: number;
  enteredBy?: string;
}

export async function spendRoutes(app: FastifyInstance) {
  app.post<{ Body: SpendBody }>(
    '/spend',
    {
      schema: {
        tags: ['admin'],
        summary: 'Insert or update ad spend for (date × campaign × source)',
        body: {
          type: 'object',
          required: ['date', 'campaign', 'source', 'spend'],
          properties: {
            date: { type: 'string', format: 'date' },
            campaign: { type: 'string', minLength: 1, maxLength: 256 },
            source: { type: 'string', minLength: 1, maxLength: 256 },
            spend: { type: 'number', minimum: 0 },
            clicks: { type: 'integer', minimum: 0 },
            impressions: { type: 'integer', minimum: 0 },
            enteredBy: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { date, campaign, source, spend, clicks, impressions, enteredBy } = req.body;
      const d = new Date(date);
      if (isNaN(d.getTime())) {
        return reply.code(400).send(err('INVALID_DATE', `Invalid date: ${date}`));
      }
      const actor = enteredBy ?? 'manual:unknown';
      const row = await prisma.adSpend.upsert({
        where: {
          ad_spend_unique_key: {
            networkId: env.GAM_NETWORK_CODE,
            date: d,
            campaign,
            source,
          },
        },
        create: {
          networkId: env.GAM_NETWORK_CODE,
          date: d,
          campaign,
          source,
          spend: new Prisma.Decimal(spend),
          clicks: BigInt(clicks ?? 0),
          impressions: BigInt(impressions ?? 0),
          enteredBy: actor,
        },
        update: {
          spend: new Prisma.Decimal(spend),
          clicks: BigInt(clicks ?? 0),
          impressions: BigInt(impressions ?? 0),
          enteredBy: actor,
          updatedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          actorEmail: actor,
          action: 'spend.upsert',
          target: `${campaign}/${source}@${date}`,
          metadata: { spend, clicks, impressions },
        },
      });
      return ok({ id: row.id.toString(), date: row.date, campaign, source, spend });
    },
  );

  app.get(
    '/spend',
    {
      schema: {
        tags: ['reports'],
        summary: 'List recent ad spend entries (latest 100)',
      },
    },
    async () => {
      const rows = await prisma.adSpend.findMany({
        orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }],
        take: 100,
      });
      return ok(
        rows.map((r) => ({
          id: r.id.toString(),
          date: r.date.toISOString().slice(0, 10),
          campaign: r.campaign,
          source: r.source,
          spend: Number(r.spend),
          clicks: Number(r.clicks),
          impressions: Number(r.impressions),
          enteredBy: r.enteredBy,
          updatedAt: r.updatedAt.toISOString(),
        })),
      );
    },
  );
}