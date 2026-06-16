'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { Period, StatusResponse } from '@gam/types';
import { PeriodSelector } from './PeriodSelector';
import { freshnessTier, relativeTime, formatIST } from '@/lib/time';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Header({
  period,
  onPeriodChange,
  status,
  networkCode,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  status: StatusResponse | undefined;
  networkCode: string;
}) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      setToast('Refresh triggered — fetching latest data');
      void qc.invalidateQueries();
      setTimeout(() => setToast(null), 3500);
    },
    onError: () => {
      setToast('Refresh failed');
      setTimeout(() => setToast(null), 3500);
    },
  });

  const tier = freshnessTier(status?.lastSuccessfulCronAt);
  const dotClass =
    tier === 'fresh'
      ? 'bg-[--color-success]'
      : tier === 'stale'
        ? 'bg-[--color-warning]'
        : 'bg-[--color-danger]';
  const tierLabel =
    tier === 'fresh' ? 'Up-to-date' : tier === 'stale' ? 'Slightly stale' : 'Stale / failed';

  return (
    <header className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[20px] font-semibold tracking-tight">GAM Arbitrage Dashboard</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[--color-text-dim]">
          <span>River Five Global</span>
          <span className="text-[--color-text-muted]">·</span>
          <span className="font-mono-num text-[--color-text-muted]">{networkCode}</span>
          <span className="text-[--color-text-muted]">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full animate-pulse', dotClass)} />
            <span>{tierLabel}</span>
            {status?.lastSuccessfulCronAt ? (
              <span className="text-[--color-text-muted]">
                · last sync {relativeTime(status.lastSuccessfulCronAt)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
            'border border-[--color-border] bg-[--color-surface] hover:bg-[--color-surface-hover]',
            'transition',
            refresh.isPending && 'opacity-60 cursor-not-allowed',
          )}
          title={
            status?.lastSuccessfulCronAt
              ? `Last sync: ${formatIST(status.lastSuccessfulCronAt)} IST`
              : 'No prior sync recorded'
          }
        >
          <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} />
          {refresh.isPending ? 'Refreshing' : 'Refresh'}
        </button>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-sm bg-[--color-surface-3] border border-[--color-border-strong] shadow-2xl">
          {toast}
        </div>
      ) : null}
    </header>
  );
}
