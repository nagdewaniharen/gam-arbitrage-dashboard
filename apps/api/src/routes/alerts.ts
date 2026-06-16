import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';
import { evaluateAlerts } from '../services/alert-engine.js';
import { ok, err } from '../lib/responses.js';

export async function alertRoutes(app: FastifyInstance) {
  app.get(
    '/alerts/rules',
    { schema: { tags: ['reports'], summary: 'List alert rules' } },
    async () => {
      const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
      return ok(rules.map((r) => ({ ...r, threshold: Number(r.threshold) })));
    },
  );

  app.post<{
    Body: { name: string; metric: string; comparison: string; threshold: number; isEnabled?: boolean };
  }>(
    '/alerts/rules',
    {
      schema: {
        tags: ['admin'],
        summary: 'Create an alert rule',
        body: {
          type: 'object',
          required: ['name', 'metric', 'comparison', 'threshold'],
          properties: {
            name: { type: 'string', minLength: 1 },
            metric: { type: 'string', enum: ['ecpm', 'revenue', 'match_rate'] },
            comparison: { type: 'string', enum: ['drop_pct_vs_7d_avg', 'below_absolute'] },
            threshold: { type: 'number' },
            isEnabled: { type: 'boolean', default: true },
          },
        },
      },
    },
    async (req) => {
      const r = await prisma.alertRule.create({
        data: {
          name: req.body.name,
          metric: req.body.metric,
          comparison: req.body.comparison,
          threshold: req.body.threshold,
          isEnabled: req.body.isEnabled ?? true,
        },
      });
      return ok({ ...r, threshold: Number(r.threshold) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/alerts/rules/:id',
    { schema: { tags: ['admin'], summary: 'Delete an alert rule' } },
    async (req, reply) => {
      try {
        await prisma.alertRule.delete({ where: { id: req.params.id } });
        return ok({ deleted: req.params.id });
      } catch {
        return reply.code(404).send(err('NOT_FOUND', 'Rule not found'));
      }
    },
  );

  app.post(
    '/alerts/evaluate',
    { schema: { tags: ['admin'], summary: 'Manually evaluate all rules (and fire to Slack if triggered)' } },
    async (req) => {
      const log = {
        info: (m: string, e?: unknown) => req.log.info({ extra: e }, m),
        warn: (m: string, e?: unknown) => req.log.warn({ extra: e }, m),
        error: (m: string, e?: unknown) => req.log.error({ extra: e }, m),
      };
      const result = await evaluateAlerts(log);
      return ok(result);
    },
  );
}
