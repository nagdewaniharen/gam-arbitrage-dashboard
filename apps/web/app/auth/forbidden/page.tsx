'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ShieldAlert, Settings, Home } from 'lucide-react';
import Link from 'next/link';

function ForbiddenInner() {
  const sp = useSearchParams();
  const reason = sp.get('reason');
  const error = sp.get('error');

  // NextAuth raises `?error=Configuration` when env credentials are missing.
  // Make that case actionable instead of a generic "access denied".
  if (error === 'Configuration') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-lg w-full text-center flex flex-col gap-3 items-center">
          <Settings size={28} className="text-[--color-warning]" />
          <h1 className="text-lg font-semibold">SSO not configured yet</h1>
          <p className="text-sm text-[--color-text-dim]">
            Google OAuth credentials haven&apos;t been added to the server environment, so
            sign-in can&apos;t complete.
          </p>
          <div className="card-2 text-left text-xs text-[--color-text-dim] w-full">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted] mb-2">
              To enable sign-in
            </div>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Create OAuth credentials in Google Cloud Console.</li>
              <li>
                Add to <code className="font-mono-num text-[--color-text]">.env</code>:
                <pre className="mt-1 p-2 rounded bg-[--color-bg] text-[10px] overflow-x-auto">{`GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
ALLOWED_GOOGLE_DOMAIN=groviaindia.shop
NEXTAUTH_SECRET=<openssl rand -hex 32>
NEXTAUTH_URL=http://localhost:3001
BOOTSTRAP_ADMIN_EMAIL=you@groviaindia.shop`}</pre>
              </li>
              <li>Restart the web server.</li>
            </ol>
          </div>
          <p className="text-xs text-[--color-text-muted]">
            For now, SSO is optional — the dashboard is open at the root URL.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
          >
            <Home size={12} />
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center flex flex-col gap-3 items-center">
        <ShieldAlert size={28} className="text-[--color-warning]" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-[--color-text-dim]">
          {reason === 'domain'
            ? 'Your Google account is not on the allowed Workspace domain. Ask your admin to grant access.'
            : reason === 'admin'
              ? 'This page is for admins only. Ask an admin to promote you from /admin/users.'
              : reason === 'inactive'
                ? 'Your account has been deactivated. Ask an admin to reactivate it.'
                : error === 'AccessDenied'
                  ? 'You declined to grant access to this app.'
                  : 'You do not have permission to view this dashboard.'}
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition mt-2"
        >
          <Home size={12} />
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}

export default function ForbiddenPage() {
  return (
    <Suspense fallback={null}>
      <ForbiddenInner />
    </Suspense>
  );
}
