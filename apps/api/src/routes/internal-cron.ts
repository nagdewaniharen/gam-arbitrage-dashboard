/**
 * Internal endpoints invoked by AWS EventBridge Scheduler.
 * Protected by HMAC signature, NOT user JWT. Never exposed in OpenAPI.
 *
 * Routes:
 *   POST /internal/cron/refresh  → hourly GAM pull
 *   POST /internal/cron/mgid     → daily MGID spend pull (Phase 3)
 *   POST /internal/cron/alerts   → periodic alert rule evaluation (Phase 4)
 */
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { verifyCronSignature } from '../lib/hmac.js';
import { runRefresh } from '../services/gam-runner.js';
import { syncMgidSpend } from '../services/mgid-client.js';
import { evaluateAlerts } from '../services/alert-engine.js';
import { ok, err } from '../lib/responses.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function verifyHmac(req: FastifyRequest, reply: FastifyReply): boolean {
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
    reply.code(401).send(err('UNAUTHORIZED', `Bad cron signature (${v.reason})`));
    return false;
  }
  return true;
}

export async function internalCronRoutes(app: FastifyInstance) {
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/internal/')) {
      route.schema = { ...route.schema, hide: true };
    }
  });

  app.post('/cron/refresh', async (req, reply) => {
    if (!verifyHmac(req, reply)) return;
    const body = (req.body ?? {}) as { daysBack?: number; backfill?: boolean };
    const result = await runRefresh(
      {
        daysBack: body.backfill ? env.GAM_BACKFILL_DAYS_ON_FIRST_RUN : (body.daysBack ?? env.GAM_INCREMENTAL_DAYS_PER_RUN),
        trigger: 'eventbridge',
      },
      logFor(req),
    );
    return ok(result);
  });

  app.post('/cron/mgid', async (req, reply) => {
    if (!verifyHmac(req, reply)) return;
    const body = (req.body ?? {}) as { daysBack?: number };
    const result = await syncMgidSpend(
      { daysBack: body.daysBack ?? 7, trigger: 'eventbridge' },
      logFor(req),
    );
    return ok(result);
  });

  app.post('/cron/alerts', async (req, reply) => {
    if (!verifyHmac(req, reply)) return;
    const result = await evaluateAlerts(logFor(req));
    return ok(result);
  });
}

function logFor(req: FastifyRequest) {
  return {
    info: (m: string, e?: unknown) => req.log.info({ extra: e }, m),
    warn: (m: string, e?: unknown) => req.log.warn({ extra: e }, m),
    error: (m: string, e?: unknown) => req.log.error({ extra: e }, m),
  };
}
