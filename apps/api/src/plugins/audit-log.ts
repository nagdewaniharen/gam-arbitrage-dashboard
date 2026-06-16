/**
 * Audit log plugin — every successful mutation (POST/PUT/PATCH/DELETE) writes
 * a row to `audit_log`. Reads (GET) are not audited (too noisy).
 *
 * Actor email is resolved from the `x-user-email` header set by NextAuth on
 * the web app — falls back to `system` for cron / unauthenticated routes.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PATHS = ['/internal/', '/api/upload-csv']; // those routes write their own audit rows

export async function auditLogPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    if (!MUTATING.has(req.method)) return;
    if (SKIP_PATHS.some((p) => req.url.startsWith(p))) return;
    if (reply.statusCode >= 400) return;
    const actor = (req.headers['x-user-email'] as string | undefined) ?? 'system';
    try {
      await prisma.auditLog.create({
        data: {
          actorEmail: actor,
          action: `${req.method.toLowerCase()}:${req.routeOptions.url ?? req.url}`,
          target: req.url,
          metadata: { statusCode: reply.statusCode },
        },
      });
    } catch (e) {
      req.log.warn({ err: e }, 'audit log insert failed');
    }
  });
}
