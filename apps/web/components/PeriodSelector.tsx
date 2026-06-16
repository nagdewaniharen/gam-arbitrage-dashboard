'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import type { Period } from '@gam/types';
import { cn } from '@/lib/cn';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

export interface CustomRange {
  from: string; // YYYY-MM-DD
  to: string;
}

export function PeriodSelector({
  value,
  onChange,
  customRange,
  onCustomRangeChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
  customRange?: CustomRange | null;
  onCustomRangeChange?: (r: CustomRange | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(customRange?.from ?? todayStr);
  const [to, setTo] = useState(customRange?.to ?? todayStr);
  const customActive = !!customRange;

  return (
    <div className="relative inline-flex items-center gap-1">
      <div
        role="tablist"
        className="inline-flex items-center gap-0.5 rounded-lg border border-[--color-border] bg-[--color-surface] p-1"
      >
        {PERIODS.map((p) => {
          const active = !customActive && value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                onCustomRangeChange?.(null);
                onChange(p.value);
              }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition',
                active
                  ? 'bg-[--color-surface-2] text-[--color-text] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  : 'text-[--color-text-dim] hover:text-[--color-text]',
              )}
            >
              {p.label}
            </button>
          );
        })}
        {onCustomRangeChange ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition',
              customActive
                ? 'bg-[--color-surface-2] text-[--color-text] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-[--color-text-dim] hover:text-[--color-text]',
            )}
          >
            <Calendar size={12} />
            {customRange ? `${customRange.from} → ${customRange.to}` : 'Custom'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute right-0 top-full mt-2 z-30 card-2 shadow-2xl min-w-[280px]">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted] mb-2">Custom range</div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-[--color-text-dim]">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input mt-1 w-full" />
            </label>
            <label className="text-xs text-[--color-text-dim]">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input mt-1 w-full" />
            </label>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  onCustomRangeChange?.({ from, to });
                  setOpen(false);
                }}
                className="text-xs px-3 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  onCustomRangeChange?.(null);
                  setOpen(false);
                }}
                className="text-xs px-3 py-1.5 rounded-md text-[--color-text-dim] hover:text-[--color-text] transition"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
