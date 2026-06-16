'use client';

import type { Period } from '@gam/types';
import { cn } from '@/lib/cn';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[--color-border] bg-[--color-surface] p-1"
    >
      {PERIODS.map((p) => {
        const active = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.value)}
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
    </div>
  );
}
