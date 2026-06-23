'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Dimension, PerformerRow } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

const HUMAN_DIM: Record<Dimension, string> = {
  campaign: 'Campaign',
  source: 'Source',
  headline: 'Headline',
  lander: 'Landing Page',
  image: 'Image',
  ad_unit: 'Ad Unit',
  page: 'Page',
  date: 'Date',
};

export function Performers({
  variant,
  by,
  onByChange,
  minImpressions,
  onMinImpressionsChange,
  rows,
  loading,
}: {
  variant: 'top' | 'bottom';
  by: Dimension;
  onByChange: (d: Dimension) => void;
  minImpressions: number;
  onMinImpressionsChange: (n: number) => void;
  rows: PerformerRow[];
  loading?: boolean;
}) {
  const accent = variant === 'top' ? 'text-[--color-success]' : 'text-[--color-danger]';
  // PRD §10.3.5 — make the variant unmistakable. Use inline styles for
  // border + bg because Tailwind 4 arbitrary CSS-var classes get stripped
  // by tailwind-merge in some combinations.
  const variantColor = variant === 'top' ? '#10b981' : '#ef4444';
  const variantStyle = {
    borderTop: `4px solid ${variantColor}`,
    background: variant === 'top' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)',
  };
  const Icon = variant === 'top' ? TrendingUp : TrendingDown;
  const label = variant === 'top' ? 'Top 10 by eCPM' : 'Bottom 10 by eCPM';
  const dims = VALID_DIMENSIONS.filter((d) => d !== 'date');

  return (
    <div className="card" style={variantStyle}>
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className={cn('inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em]', accent)}>
          <Icon size={12} />
          {label}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={by}
            onChange={(e) => onByChange(e.target.value as Dimension)}
            className="input"
            title="Dimension"
          >
            {dims.map((d) => (
              <option key={d} value={d}>
                by {HUMAN_DIM[d]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-[--color-text-muted]" title="Minimum impressions filter">
            min impr.
            <input
              type="number"
              value={minImpressions}
              onChange={(e) => onMinImpressionsChange(Math.max(0, Number(e.target.value)))}
              className="input w-16 font-mono-num"
              min={0}
              step={10}
            />
          </label>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
          <tr>
            <th className="text-left font-medium pb-2 w-8">#</th>
            <th className="text-left font-medium pb-2">Name</th>
            <th className="text-right font-medium pb-2">Impr.</th>
            <th className="text-right font-medium pb-2">Revenue</th>
            <th className="text-right font-medium pb-2">eCPM</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-t border-[--color-border]">
                <td colSpan={5} className="py-2">
                  <div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-sm text-[--color-text-muted]">
                {['campaign', 'source', 'headline', 'lander', 'image'].includes(by) ? (
                  <span>
                    Waiting on GAM custom-targeting reporting access.{' '}
                    <span className="text-[--color-text-dim]">
                      Will fill automatically once enabled.
                    </span>
                  </span>
                ) : (
                  'No data — try lowering min impressions'
                )}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.rank}-${r.name}`} className="border-t border-[--color-border] row-hover">
                <td className="py-2 text-[--color-text-muted] font-mono-num">{r.rank}</td>
                <td className="truncate max-w-[180px] text-[--color-text]" title={r.name}>
                  {r.name || <span className="text-[--color-text-muted]">(empty)</span>}
                </td>
                <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.num(r.impressions)}</td>
                <td className="text-right font-mono-num">{fmt.usd(r.revenue)}</td>
                <td className={cn('text-right font-mono-num font-medium', accent)}>{fmt.ecpm(r.ecpm)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
