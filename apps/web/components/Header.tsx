'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { Period, StatusResponse } from '@gam/types';
import { PeriodSelector, type CustomRange } from './PeriodSelector';
import { UserMenu } from './UserMenu';
import { freshnessTier, relativeTime, formatIST } from '@/lib/time';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function Header({
  period,
  onPeriodChange,
  customRange,
  onCustomRangeChange,
  status,
  networkCode,
}: {
  period: Period;
  onPeriodChange: (_p: Period) => void;
  customRange?: CustomRange | null;
  onCustomRangeChange?: (_r: CustomRange | null) => void;
  status: StatusResponse | undefined;
  networkCode: string;
}) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: async () => {
      // Pull last 7 days — covers all visible windows (Today / 7d / 30d
      // re-aggregate from same rows). Faster than a 30-day pull (~15s vs
      // ~30s) which is the difference between "snappy" and "broken-feeling".
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const res = await fetch(`${BASE}/api/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daysBack: 7 }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
        return res.json();
      } finally {
        clearTimeout(timeout);
      }
    },
    onSuccess: (data) => {
      const rows = data?.data?.rowsUpserted ?? 0;
      setToast(`Refresh complete — ${rows} rows updated from GAM`);
      void qc.invalidateQueries();
      setTimeout(() => setToast(null), 3500);
    },
    onError: (e) => {
      setToast(`Refresh failed: ${(e as Error).message}`);
      setTimeout(() => setToast(null), 4500);
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
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
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
          <span className="hidden sm:inline">{refresh.isPending ? 'Refreshing' : 'Refresh'}</span>
        </button>
        <PeriodSelector
          value={period}
          onChange={onPeriodChange}
          customRange={customRange}
          onCustomRangeChange={onCustomRangeChange}
        />
        <UserMenu />
      </div>
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-sm bg-[--color-surface-3] border border-[--color-border-strong] shadow-2xl">
          {toast}
        </div>
      ) : null}
    </header>
  );
}
