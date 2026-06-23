'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Providers wraps the app tree.
 *
 * SSO is deferred (ADR-013 / ADR-014). When ready to re-enable, restore the
 * NextAuth `SessionProvider` import — but ONLY behind a dynamic import, since
 * importing `next-auth/react` at module-load currently breaks Next.js 15 build
 * under NextAuth 5 beta (page routes silently fail to compile, only
 * `_not-found` registers).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Always refetch on mount — fixes the "first-load shows zeros"
            // case where a stale cached response (or another tab's data)
            // briefly flashes through before the live query lands.
            staleTime: 0,
            refetchOnMount: 'always',
            refetchInterval: 5 * 60 * 1000, // PRD §10.1 — 5-min auto-refresh
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
