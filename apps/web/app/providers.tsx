'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState } from 'react';

const AUTH_ENABLED = !!process.env.NEXT_PUBLIC_SSO_ENABLED;

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

  // QueryClientProvider is always needed (dashboard data fetching).
  // SessionProvider only mounts when auth/SSO is enabled — otherwise it
  // calls /api/auth/session and throws ClientFetchError in Phase 1.
  const tree = <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  if (!AUTH_ENABLED) {
    return tree;
  }
  return <SessionProvider>{tree}</SessionProvider>;
}