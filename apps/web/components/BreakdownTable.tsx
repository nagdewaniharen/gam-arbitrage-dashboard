'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { BreakdownRow, Dimension } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

type SortKey = 'name' | 'impressions' | 'revenue' | 'ecpm' | 'ctr';
type SortDir = 'asc' | 'desc';

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

export function BreakdownTable({
  dim,
  rows,
  onDimChange,
  loading,
  ecpmHi,
  ecpmLo,
  excludeDim,
}: {
  dim: Dimension;
  rows: BreakdownRow[];
  onDimChange: (d: Dimension) => void;
  loading?: boolean;
  ecpmHi?: number;
  ecpmLo?: number;
  /** Dimension to disable in the dropdown (e.g. the dim shown in the sibling table) */
  excludeDim?: Dimension;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const dims = VALID_DIMENSIONS.filter((d) => d !== 'date');

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortKey === 'name' ? a.name : (a[sortKey] as number);
      const bv = sortKey === 'name' ? b.name : (b[sortKey] as number);
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  }

  const ecpmClass = (e: number) => {
    if (ecpmHi != null && e >= ecpmHi) return 'text-[--color-success]';
    if (ecpmLo != null && e <= ecpmLo) return 'text-[--color-danger]';
    return '';
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            By {HUMAN_DIM[dim]}
          </div>
          <span className="text-[10px] text-[--color-text-muted]">{rows.length} rows</span>
        </div>
        <select
          value={dim}
          onChange={(e) => onDimChange(e.target.value as Dimension)}
          className="input"
        >
          {dims.map((d) => (
            <option key={d} value={d} disabled={d === excludeDim}>
              {HUMAN_DIM[d]}
              {d === excludeDim ? '  (in other table)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
            <tr>
              <SortHeader label="Name" align="left" k="name" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Impr." align="right" k="impressions" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Revenue" align="right" k="revenue" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="eCPM" align="right" k="ecpm" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="CTR" align="right" k="ctr" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
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
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-[--color-text-muted]">
                  No data
                </td>
              </tr>
            ) : (
              sorted.slice(0, 25).map((r) => (
                <tr key={r.name} className="border-t border-[--color-border] row-hover">
                  <td className="py-2 truncate max-w-[200px] text-[--color-text]" title={r.name}>
                    {r.name || <span className="text-[--color-text-muted]">(empty)</span>}
                  </td>
                  <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.num(r.impressions)}</td>
                  <td className="text-right font-mono-num">{fmt.usd(r.revenue)}</td>
                  <td className={cn('text-right font-mono-num', ecpmClass(r.ecpm))}>{fmt.ecpm(r.ecpm)}</td>
                  <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.pct(r.ctr)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={cn(
        'pb-2 pt-0 font-medium cursor-pointer select-none',
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
