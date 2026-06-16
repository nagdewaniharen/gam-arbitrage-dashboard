/**
 * Edge middleware — three layers:
 *
 * 1. Phase-1 mode (no `GOOGLE_OAUTH_CLIENT_ID` env): every page is open.
 * 2. Phase-2 mode (SSO on): redirect unauthenticated requests to /auth/signin.
 * 3. Admin pages (/admin/*): require an `admin` role claim in the JWT.
 *
 * Edge-level role check is a fast UX layer; the API server independently
 * verifies the same JWT before serving any data (apps/api/src/plugins/auth.ts),
 * so a forged cookie can't bypass actual authorization.
 */
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/api/auth', '/_next', '/favicon.ico'];
const ADMIN_PATHS = ['/admin'];

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = parts[1]!;
      const json = Buffer.from(payload, 'base64url').toString('utf-8');
      return JSON.parse(json);
    }
    return null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Phase-1: SSO not configured -> every page open.
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) return NextResponse.next();

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const sessionToken =
    req.cookies.get('authjs.session-token')?.value ??
    req.cookies.get('__Secure-authjs.session-token')?.value;

  if (!sessionToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/signin';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  // Admin-only gate
  if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    const claims = decodeJwtClaims(sessionToken);
    const role = (claims?.role as string | undefined) ?? 'user';
    if (role !== 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/auth/forbidden';
      url.searchParams.set('reason', 'admin');
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
