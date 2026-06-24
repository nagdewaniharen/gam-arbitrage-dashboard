'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import type { CrossRow, Dimension } from '@gam/types';
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

type SortKey = 'dim1' | 'dim2' | 'impressions' | 'revenue' | 'ecpm' | 'ctr';
type SortDir = 'asc' | 'desc';

export function CrossAnalysis({
  dim1,
  dim2,
  rows,
  onDim1Change,
  onDim2Change,
  loading,
}: {
  dim1: Dimension;
  dim2: Dimension;
  rows: CrossRow[];
  onDim1Change: (_d: Dimension) => void;
  onDim2Change: (_d: Dimension) => void;
  loading?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [query, setQuery] = useState('');
  const dims = VALID_DIMENSIONS.filter((d) => d !== 'date');

  const filtered = useMemo(() => {
    let arr = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter(
        (r) => r.dim1.toLowerCase().includes(q) || r.dim2.toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir, query]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'dim1' || k === 'dim2' ? 'asc' : 'desc');
    }
  }

  const sameDim = dim1 === dim2;

  return (
    <div className="card">
      <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Cross-Dimensional Analysis
          </div>
          <span className="text-[10px] text-[--color-text-muted]">
            {filtered.length}
            {filtered.length !== rows.length ? ` of ${rows.length}` : ''} combos
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dim1}
            onChange={(e) => onDim1Change(e.target.value as Dimension)}
            className="input"
          >
            {dims.map((d) => (
              <option key={d} value={d}>
                {HUMAN_DIM[d]}
              </option>
            ))}
          </select>
          <span className="text-[--color-text-muted] text-xs">×</span>
          <select
            value={dim2}
            onChange={(e) => onDim2Change(e.target.value as Dimension)}
            className="input"
          >
            {dims.map((d) => (
              <option key={d} value={d}>
                {HUMAN_DIM[d]}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[--color-text-muted]"
            />
            <input
              type="search"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-7 w-36"
            />
          </div>
        </div>
      </div>
      {sameDim ? (
        <div className="py-10 text-center text-sm text-[--color-text-muted]">
          Choose two different dimensions to compare.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
              <tr>
                <SortHeader label={HUMAN_DIM[dim1]} k="dim1" align="left" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label={HUMAN_DIM[dim2]} k="dim2" align="left" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="Impr." k="impressions" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="Revenue" k="revenue" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="eCPM" k="ecpm" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="CTR" k="ctr" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-[--color-border]">
                    <td colSpan={6} className="py-2">
                      <div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr className="border-t border-[--color-border]">
                  <td colSpan={6} className="py-8 text-center text-sm text-[--color-text-muted]">
                    {(['campaign', 'source', 'headline', 'lander', 'image'] as const).some((d) =>
                      [dim1, dim2].includes(d),
                    ) ? (
                      <span>
                        Waiting on GAM custom-targeting reporting access.{' '}
                        <span className="text-[--color-text-dim]">
                          Once enabled, this cross-dimension view fills automatically.
                        </span>
                      </span>
                    ) : (
                      'No combinations match'
                    )}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((r, i) => (
                  <tr key={`${r.dim1}-${r.dim2}-${i}`} className="border-t border-[--color-border] row-hover">
                    <td className="py-2 truncate max-w-[160px] text-[--color-text]" title={r.dim1}>
                      {r.dim1 || <span className="text-[--color-text-muted]">(empty)</span>}
                    </td>
                    <td className="truncate max-w-[160px] text-[--color-text]" title={r.dim2}>
                      {r.dim2 || <span className="text-[--color-text-muted]">(empty)</span>}
                    </td>
                    <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.num(r.impressions)}</td>
                    <td className="text-right font-mono-num">{fmt.usd(r.revenue)}</td>
                    <td className="text-right font-mono-num">{fmt.ecpm(r.ecpm)}</td>
                    <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.pct(r.ctr)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  k,
  align,
  sortKey,
  dir,
  onClick,
}: {
  label: string;
  k: SortKey;
  align: 'left' | 'right';
  sortKey: SortKey;
  dir: SortDir;
  onClick: (_k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={cn(
        'pb-2 font-medium',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn(
          'inline-flex items-center gap-1 transition',
          active ? 'text-[--color-text]' : 'hover:text-[--color-text-dim]',
        )}
      >
        {label}
        {active ? dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} /> : null}
      </button>
    </th>
  );
}
