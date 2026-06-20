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
            staleTime: 60 * 1000,
            refetchInterval: 5 * 60 * 1000, // 5 minutes per PRD §9.1
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
