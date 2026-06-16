/**
 * Edge middleware — gates every page except the auth-related ones.
 * SSO is OPT-IN: only kicks in when GOOGLE_OAUTH_CLIENT_ID is set in the
 * environment. Otherwise the dashboard runs auth-free (Phase 1 mode).
 */
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/api/auth', '/_next', '/favicon.ico'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // If SSO is not configured, no gate.
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) return NextResponse.next();

  // Public routes never gated
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Check NextAuth session JWT cookie (don't import auth() — it's Node-only)
  const sessionCookie =
    req.cookies.get('authjs.session-token')?.value ??
    req.cookies.get('__Secure-authjs.session-token')?.value;
  if (!sessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/signin';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
