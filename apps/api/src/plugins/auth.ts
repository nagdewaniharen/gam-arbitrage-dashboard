/**
 * NextAuth JWT verification plugin for the Fastify API.
 *
 * The Next.js web app stores its NextAuth session as a JWT cookie. We verify
 * that same JWT using `jose` and the shared `NEXTAUTH_SECRET`. If a request
 * has a valid cookie -> `req.user` is set. Otherwise -> 401.
 *
 * Opt-in: the gate only fires when `NEXTAUTH_SECRET` is configured. If it's
 * missing, the API runs unauthenticated (Phase 1 mode).
 *
 * Allowlist: routes in OPEN_PATHS skip the gate even when auth is on.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';

const OPEN_PATHS = ['/api/health', '/api/status', '/docs', '/internal/'];

declare module 'fastify' {
  interface FastifyRequest {
    user?: { email: string; role: 'admin' | 'user' };
  }
}

export async function authPlugin(app: FastifyInstance) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    app.log.warn('NEXTAUTH_SECRET not set — API auth gate DISABLED (Phase 1 mode)');
    return;
  }
  const key = new TextEncoder().encode(secret);

  app.addHook('preHandler', async (req, reply) => {
    if (OPEN_PATHS.some((p) => req.url.startsWith(p))) return;

    const cookieHeader = req.headers.cookie ?? '';
    const sessionToken =
      readCookie(cookieHeader, 'authjs.session-token') ??
      readCookie(cookieHeader, '__Secure-authjs.session-token');

    if (!sessionToken) {
      return reply.code(401).send({
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'No session cookie' },
      });
    }
    try {
      const { payload } = await jwtVerify(sessionToken, key, { algorithms: ['HS256'] });
      const email = (payload.email as string | undefined) ?? '';
      const role = ((payload as { role?: string }).role ?? 'user') as 'admin' | 'user';
      if (!email) {
        return reply.code(401).send({ ok: false, error: { code: 'NO_EMAIL', message: 'Session has no email' } });
      }
      req.user = { email, role };
    } catch (e) {
      req.log.warn({ err: e }, 'invalid session token');
      return reply
        .code(401)
        .send({ ok: false, error: { code: 'INVALID_SESSION', message: 'Bad or expired session' } });
    }
  });
}

function readCookie(header: string, name: string): string | undefined {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** Use as a per-route preHandler to require admin role. */
export function requireAdmin(req: FastifyRequest, reply: import('fastify').FastifyReply, done: (err?: Error) => void): void {
  if (!req.user) {
    reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: '' } });
    return;
  }
  if (req.user.role !== 'admin') {
    reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin role required' } });
    return;
  }
  done();
}
