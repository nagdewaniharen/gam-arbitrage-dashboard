/**
 * Internal endpoints invoked by AWS EventBridge Scheduler.
 * Protected by HMAC signature, NOT user JWT. Never exposed in OpenAPI.
 */
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { verifyCronSignature } from '../lib/hmac.js';
import { runRefresh } from '../services/gam-runner.js';
import { ok, err } from '../lib/responses.js';

export async function internalCronRoutes(app: FastifyInstance) {
  // Hide from OpenAPI:
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/internal/')) {
      route.schema = { ...route.schema, hide: true };
    }
  });

  app.post('/cron/refresh', async (req, reply) => {
    const signature = req.headers['x-cron-signature'];
    const timestamp = req.headers['x-cron-timestamp'];
    const sig = Array.isArray(signature) ? signature[0]! : (signature as string | undefined) ?? '';
    const ts = Array.isArray(timestamp) ? timestamp[0]! : (timestamp as string | undefined) ?? '';
    const bodyStr = JSON.stringify(req.body ?? {});

    const v = verifyCronSignature({
      secret: env.INTERNAL_CRON_SECRET,
      timestamp: ts,
      body: bodyStr,
      signature: sig,
    });
    if (!v.ok) {
      req.log.warn({ reason: v.reason }, 'cron signature rejected');
      return reply.code(401).send(err('UNAUTHORIZED', `Bad cron signature (${v.reason})`));
    }

    const body = (req.body ?? {}) as { daysBack?: number; backfill?: boolean };
    const result = await runRefresh(
      {
        daysBack: body.backfill ? env.GAM_BACKFILL_DAYS_ON_FIRST_RUN : (body.daysBack ?? env.GAM_INCREMENTAL_DAYS_PER_RUN),
        trigger: 'eventbridge',
      },
      {
        info: (m, e) => req.log.info({ extra: e }, m),
        warn: (m, e) => req.log.warn({ extra: e }, m),
        error: (m, e) => req.log.error({ extra: e }, m),
      },
    );
    return ok(result);
  });
}
