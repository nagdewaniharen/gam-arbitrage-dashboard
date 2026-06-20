import type { FastifyInstance } from 'fastify';
import { runRefresh } from '../services/gam-runner.js';
import { ok } from '../lib/responses.js';

/**
 * Manual GAM refresh. Admin-triggered (auth in Phase 2C). Synchronously
 * runs the same flow as the EventBridge cron.
 */
export async function refreshRoutes(app: FastifyInstance) {
  app.post<{ Body: { daysBack?: number; backfill?: boolean } }>(
    '/refresh',
    {
      schema: {
        tags: ['admin'],
        summary: 'Manually trigger GAM data refresh',
        body: {
          type: 'object',
          properties: {
            daysBack: { type: 'integer', minimum: 1, maximum: 365 },
            backfill: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (req) => {
      const { daysBack, backfill } = req.body ?? {};
      const result = await runRefresh(
        { daysBack, trigger: backfill ? 'manual-backfill' : 'manual' },
        {
          info: (m, e) => req.log.info({ extra: e }, m),
          warn: (m, e) => req.log.warn({ extra: e }, m),
          error: (m, e) => req.log.error({ extra: e }, m),
        },
      );
      return ok(result);
    },
  );
}