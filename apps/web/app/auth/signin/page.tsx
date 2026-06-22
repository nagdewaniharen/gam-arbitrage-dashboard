import { LogIn } from 'lucide-react';
import { signIn } from '@/lib/auth';

/**
 * Sign-in page. NextAuth v5 requires POST with CSRF for /api/auth/signin/...
 * Instead of building that form manually, use a server action that calls
 * `signIn('google')` server-side — Next.js handles CSRF automatically.
 *
 * Server actions only run on form submit, so this still avoids importing
 * `next-auth/react` (which historically broke the Next.js 15 build under v5).
 */
export default function SignInPage() {
  async function handleSignIn() {
    'use server';
    await signIn('google', { redirectTo: '/' });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center flex flex-col gap-4 items-center">
        <h1 className="text-xl font-semibold">GAM Arbitrage Dashboard</h1>
        <p className="text-sm text-[--color-text-dim]">
          Sign in with your Google Workspace account to continue.
        </p>
        <form action={handleSignIn}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
          >
            <LogIn size={14} />
            Sign in with Google
          </button>
        </form>
        <p className="text-xs text-[--color-text-muted]">
          Access is restricted to authorized Workspace users only.
        </p>
      </div>
    </main>
  );
}
