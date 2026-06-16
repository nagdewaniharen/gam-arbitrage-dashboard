/**
 * NextAuth v5 (beta) configuration with Google OAuth.
 * Restricts to allowed Workspace domain. Promotes BOOTSTRAP_ADMIN_EMAIL on
 * first login. Persists user records in our Postgres via Prisma adapter.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@gam/db';

const ALLOWED_DOMAIN = process.env.ALLOWED_GOOGLE_DOMAIN ?? '';
const BOOTSTRAP_ADMIN = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').toLowerCase();

export const { handlers, signIn, signOut, auth } = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();
      // Domain gate
      if (ALLOWED_DOMAIN && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return `/auth/forbidden?reason=domain`;
      }
      // Auto-promote bootstrap admin
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
        token.role = dbUser?.role ?? 'user';
        token.isActive = dbUser?.isActive ?? true;
      }
      return token;
    },
    async session({ session, token }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).role = (token as any).role ?? 'user';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).isActive = (token as any).isActive ?? true;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/forbidden',
  },
});
