import { LogIn } from 'lucide-react';

/**
 * Sign-in page. SSO is currently deferred (ADR-013). Uses a plain anchor to
 * `/api/auth/signin/google` so we avoid importing `next-auth/react` (which
 * breaks the Next.js 15 build under NextAuth 5 beta).
 */
export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center flex flex-col gap-4 items-center">
        <h1 className="text-xl font-semibold">GAM Arbitrage Dashboard</h1>
        <p className="text-sm text-[--color-text-dim]">
          Sign in with your Google Workspace account to continue.
        </p>
        <a
          href="/api/auth/signin/google?callbackUrl=/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
        >
          <LogIn size={14} />
          Sign in with Google
        </a>
        <p className="text-xs text-[--color-text-muted]">
          Access is restricted to authorized Workspace users only.
        </p>
      </div>
    </main>
  );
}
