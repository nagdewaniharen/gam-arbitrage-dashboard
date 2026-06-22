'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, ArrowRight } from 'lucide-react';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface CompareResp {
  a: { from: string; to: string; impressions: number; clicks: number; revenue: number; ecpm: number; ctr: number };
  b: { from: string; to: string; impressions: number; clicks: number; revenue: number; ecpm: number; ctr: number };
  changes: { revenuePct: number; impressionsPct: number; ecpmPct: number; clicksPct: number };
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return toIso(d);
}

const PRESETS = [
  {
    key: 'wow',
    label: 'This week vs last week',
    range: () => ({ fromA: daysAgo(6), toA: toIso(new Date()), fromB: daysAgo(13), toB: daysAgo(7) }),
  },
  {
    key: 'mom',
    label: 'This month vs last month',
    range: () => ({ fromA: daysAgo(29), toA: toIso(new Date()), fromB: daysAgo(59), toB: daysAgo(30) }),
  },
] as const;

export function CompareDates() {
  const initial = PRESETS[0].range();
  const [r, setR] = useState(initial);

  const q = useQuery<CompareResp>({
    queryKey: ['compare', r.fromA, r.toA, r.fromB, r.toB],
    queryFn: async () => {
      const sp = new URLSearchParams(r as unknown as Record<string, string>);
      const res = await fetch(`${BASE}/api/compare?${sp.toString()}`);
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message);
      return body.data;
    },
  });

  return (
    <div className="card">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
          Date Range Compare
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => {
            const isCurrent = JSON.stringify(p.range()) === JSON.stringify(r);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setR(p.range())}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-md transition',
                  isCurrent
                    ? 'bg-[--color-surface-2] text-[--color-text]'
                    : 'text-[--color-text-dim] hover:text-[--color-text]',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <DateField label="A from" value={r.fromA} onChange={(v) => setR({ ...r, fromA: v })} />
        <DateField label="A to" value={r.toA} onChange={(v) => setR({ ...r, toA: v })} />
        <DateField label="B from" value={r.fromB} onChange={(v) => setR({ ...r, fromB: v })} />
        <DateField label="B to" value={r.toB} onChange={(v) => setR({ ...r, toB: v })} />
      </div>

      {q.isLoading ? (
        <div className="h-24 rounded bg-[--color-surface-2] animate-pulse" />
      ) : !q.data ? (
        <div className="py-6 text-center text-sm text-[--color-text-muted]">No data</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompareCell label="Revenue" a={fmt.usd(q.data.a.revenue)} b={fmt.usd(q.data.b.revenue)} pct={q.data.changes.revenuePct} />
          <CompareCell label="Impressions" a={fmt.num(q.data.a.impressions)} b={fmt.num(q.data.b.impressions)} pct={q.data.changes.impressionsPct} />
          <CompareCell label="eCPM" a={fmt.ecpm(q.data.a.ecpm)} b={fmt.ecpm(q.data.b.ecpm)} pct={q.data.changes.ecpmPct} />
          <CompareCell label="Clicks" a={fmt.num(q.data.a.clicks)} b={fmt.num(q.data.b.clicks)} pct={q.data.changes.clicksPct} />
        </div>
      )}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted]">
      {label}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="input mt-1 w-full" />
    </label>
  );
}

function CompareCell({ label, a, b, pct }: { label: string; a: string; b: string; pct: number }) {
  const up = pct >= 0;
  return (
    <div className="card-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted] mb-1.5">{label}</div>
      <div className="flex items-baseline gap-2 font-mono-num">
        <span className="text-lg">{a}</span>
        <ArrowRight size={11} className="text-[--color-text-muted]" />
        <span className="text-sm text-[--color-text-dim]">{b}</span>
      </div>
      <div className={cn('inline-flex items-center gap-1 text-xs font-mono-num mt-1', up ? 'text-[--color-success]' : 'text-[--color-danger]')}>
        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {Math.abs(pct).toFixed(1)}%
      </div>
    </div>
  );
}
