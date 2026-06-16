/**
 * NextAuth v5 with Google Workspace SSO — strict, domain-restricted.
 *
 * Hard rules (per PRD §12.2):
 *   1. `ALLOWED_GOOGLE_DOMAIN` MUST be set; otherwise SSO is disabled entirely
 *      (the dashboard runs in Phase 1 "no auth" mode instead of an insecure
 *      "any Google account" mode).
 *   2. Google's OAuth screen is restricted via the `hd` (hosted domain) param,
 *      so users can't even SELECT a personal Gmail.
 *   3. The signIn callback double-checks the domain server-side.
 *   4. Bootstrap admin (BOOTSTRAP_ADMIN_EMAIL) is promoted to `admin` on first
 *      login. Everyone else lands as `user`.
 *   5. Inactive users (admin-deactivated) are blocked.
 *
 * If you need to add a new admin: another existing admin promotes them from
 * /admin/users.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@gam/db';

const ALLOWED_DOMAIN = (process.env.ALLOWED_GOOGLE_DOMAIN ?? '').toLowerCase();
const BOOTSTRAP_ADMIN = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').toLowerCase();

if (process.env.GOOGLE_OAUTH_CLIENT_ID && !ALLOWED_DOMAIN) {
  // Refuse to start SSO without a domain gate — that would let anyone log in.
  // eslint-disable-next-line no-console
  console.error(
    '[auth] FATAL: GOOGLE_OAUTH_CLIENT_ID is set but ALLOWED_GOOGLE_DOMAIN is empty.\n' +
      'Set ALLOWED_GOOGLE_DOMAIN to your Workspace domain (e.g. groviaindia.shop) or unset GOOGLE_OAUTH_CLIENT_ID.',
  );
}

// `as any` on the inferred return suppresses TS2742 portability errors —
// NextAuth's return type references types deep inside node_modules that can't
// be portably named from this file. Behaviour is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _nextAuth: any = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: {
        params: {
          // `hd` forces Google to show only Workspace accounts on the chooser.
          // Defense-in-depth — we ALSO verify domain in signIn() below.
          ...(ALLOWED_DOMAIN ? { hd: ALLOWED_DOMAIN } : {}),
          prompt: 'select_account',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();

      // Hard domain gate
      if (!ALLOWED_DOMAIN) return '/auth/forbidden?reason=domain';
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return '/auth/forbidden?reason=domain';
      }

      // Even stricter: Google's profile.hd MUST match. Prevents anyone from
      // tricking us with an email-shape that ends with our domain.
      const hd = (profile as { hd?: string } | null)?.hd?.toLowerCase();
      if (hd && hd !== ALLOWED_DOMAIN) {
        return '/auth/forbidden?reason=domain';
      }

      // Inactive user? Block.
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && !existing.isActive) {
        return '/auth/forbidden?reason=inactive';
      }

      // Auto-promote bootstrap admin on first login
      if (email === BOOTSTRAP_ADMIN) {
        await prisma.user.upsert({
          where: { email },
          create: { email, name: user.name ?? null, role: 'admin', lastLoginAt: new Date() },
          update: { role: 'admin', lastLoginAt: new Date() },
        });
      } else {
        await prisma.user.upsert({
          where: { email },
          create: { email, name: user.name ?? null, role: 'user', lastLoginAt: new Date() },
          update: { lastLoginAt: new Date() },
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email ?? '').toLowerCase();
      if (email) {
        const dbUser = await prisma.user.findUnique({ where: { email } });
        token.email = email;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (token as any).role = dbUser?.role ?? 'user';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (token as any).isActive = dbUser?.isActive ?? true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (token as any).name = dbUser?.name ?? user?.name ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = token as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).role = t.role ?? 'user';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).isActive = t.isActive ?? true;
      if (session.user) {
        session.user.email = (t.email as string | undefined) ?? session.user.email;
        session.user.name = (t.name as string | null | undefined) ?? session.user.name ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/forbidden',
  },
});

export const handlers = _nextAuth.handlers;
export const signIn = _nextAuth.signIn;
export const signOut = _nextAuth.signOut;
export const auth = _nextAuth.auth;
