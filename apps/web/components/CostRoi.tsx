'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Period } from '@gam/types';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface CostRoiRow {
  campaign: string;
  source: string;
  revenue: number;
  spend: number;
  profit: number;
  roiPct: number;
  roas: number;
  impressions: number;
  clicks: number;
}

interface CostRoiResponse {
  period: Period;
  rows: CostRoiRow[];
  totals: { revenue: number; spend: number; profit: number; roiPct: number; roas: number };
}

type SortKey = 'campaign' | 'source' | 'revenue' | 'spend' | 'profit' | 'roiPct' | 'roas';
type SortDir = 'asc' | 'desc';

async function fetchCostRoi(period: Period): Promise<CostRoiResponse> {
  const res = await fetch(`${BASE}/api/cost-roi?period=${period}&limit=200`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message);
  return body.data;
}

export function CostRoi({ period }: { period: Period }) {
  const [sortKey, setSortKey] = useState<SortKey>('profit');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { data, isLoading } = useQuery({
    queryKey: ['cost-roi', period],
    queryFn: () => fetchCostRoi(period),
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.rows];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'campaign' || k === 'source' ? 'asc' : 'desc');
    }
  }

  const totals = data?.totals;
  const totalProfit = totals?.profit ?? 0;
  const totalProfitGood = totalProfit >= 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Cost &amp; ROI
          </div>
          <span className="text-[10px] text-[--color-text-muted]">
            {data ? `${data.rows.length} rows` : '…'}
          </span>
        </div>
        {totals ? (
          <div className="flex items-center gap-3 text-xs font-mono-num">
            <span className="text-[--color-text-muted]">Spend</span>
            <span>{fmt.usd(totals.spend)}</span>
            <span className="text-[--color-text-muted]">·</span>
            <span className="text-[--color-text-muted]">Revenue</span>
            <span>{fmt.usd(totals.revenue)}</span>
            <span className="text-[--color-text-muted]">·</span>
            <span className="text-[--color-text-muted]">Profit</span>
            <span className={totalProfitGood ? 'text-[--color-success]' : 'text-[--color-danger]'}>
              {fmt.usd(totals.profit)}
            </span>
            <span className="text-[--color-text-muted]">·</span>
            <span className="text-[--color-text-muted]">ROI</span>
            <span className={totals.roiPct >= 0 ? 'text-[--color-success]' : 'text-[--color-danger]'}>
              {totals.roiPct.toFixed(1)}%
            </span>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
            <tr>
              <SortHeader label="Campaign" k="campaign" align="left" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Source" k="source" align="left" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Revenue" k="revenue" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Spend" k="spend" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Profit" k="profit" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="ROI %" k="roiPct" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="ROAS" k="roas" align="right" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-[--color-border]">
                  <td colSpan={7} className="py-2">
                    <div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" />
                  </td>
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-[--color-text-muted]">
                  No spend or revenue data
                </td>
              </tr>
            ) : (
              sorted.slice(0, 50).map((r, i) => (
                <tr key={`${r.campaign}-${r.source}-${i}`} className="border-t border-[--color-border] row-hover">
                  <td className="py-2 truncate max-w-[140px] text-[--color-text]" title={r.campaign}>
                    {r.campaign}
                  </td>
                  <td className="truncate max-w-[100px] text-[--color-text-dim]" title={r.source}>
                    {r.source}
                  </td>
                  <td className="text-right font-mono-num">{fmt.usd(r.revenue)}</td>
                  <td className="text-right font-mono-num text-[--color-text-dim]">{fmt.usd(r.spend)}</td>
                  <td
                    className={cn(
                      'text-right font-mono-num font-medium',
                      r.profit >= 0 ? 'text-[--color-success]' : 'text-[--color-danger]',
                    )}
                  >
                    {fmt.usd(r.profit)}
                  </td>
                  <td className={cn('text-right font-mono-num', r.roiPct >= 0 ? 'text-[--color-success]' : 'text-[--color-danger]')}>
                    {r.spend > 0 ? `${r.roiPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="text-right font-mono-num text-[--color-text-dim]">
                    {r.spend > 0 ? r.roas.toFixed(2) : '—'}
                  </td>
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
    <th className={cn('pb-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn('inline-flex items-center gap-1 transition', active ? 'text-[--color-text]' : 'hover:text-[--color-text-dim]')}
      >
        {label}
        {active ? dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} /> : null}
      </button>
    </th>
  );
}
