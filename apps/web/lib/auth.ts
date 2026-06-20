/**
 * SSO is currently deferred (ADR-013 / ADR-014).
 *
 * The real NextAuth wiring (Google Workspace OAuth, domain gate, role
 * promotion) lives in this file's git history — restore it from there when
 * we re-enable SSO.
 *
 * Why this file is stubbed:
 *   Statically importing next-auth / next-auth/providers/google /
 *   @auth/prisma-adapter at module load currently breaks the Next.js 15
 *   build under NextAuth v5 beta — silently, with no error. Symptom is
 *   every page returning 404 (only /_not-found compiles). Removing the
 *   imports here fixes the build.
 *
 * The exports below keep auth-handlers.ts and any other consumers
 * compiling without pulling in the broken modules. Re-enabling SSO is a
 * single revert away.
 */
type Handler = (...args: unknown[]) => Promise<Response>;
const ssoDisabled: Handler = async () =>
  new Response('SSO not enabled (ADR-013)', { status: 501 });

export const handlers = { GET: ssoDisabled, POST: ssoDisabled };
export const auth = async (): Promise<null> => null;
export const signIn = async (): Promise<undefined> => undefined;
export const signOut = async (): Promise<undefined> => undefined;
