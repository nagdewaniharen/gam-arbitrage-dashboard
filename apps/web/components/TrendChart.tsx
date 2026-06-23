'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '@gam/types';
import { fmt } from '@/lib/format';

export function TrendChart({ points, loading }: { points: TrendPoint[]; loading?: boolean }) {
  const hasData = !loading && points.length > 0;
  const avg =
    points.length > 0 ? points.reduce((a, p) => a + p.revenue, 0) / points.length : 0;
  const total = points.reduce((a, p) => a + p.revenue, 0);

  return (
    <div className="card h-80">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Revenue Trend
          </div>
          {hasData ? (
            <div className="mt-0.5 text-sm text-[--color-text-dim]">
              <span className="text-[--color-text] font-mono-num">{fmt.usd(total)}</span>
              <span className="text-[--color-text-muted]"> total · </span>
              <span className="text-[--color-text] font-mono-num">{fmt.usd(avg)}</span>
              <span className="text-[--color-text-muted]"> avg/day · {points.length} days</span>
            </div>
          ) : null}
        </div>
      </div>
      {loading ? (
        <div className="h-[82%] w-full rounded-md bg-[--color-surface-2] animate-pulse" />
      ) : points.length === 0 ? (
        <EmptyState label="No data for this period" />
      ) : (
        <ResponsiveContainer width="100%" height="82%">
          <BarChart
            data={points}
            margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke="#252a33" vertical={false} strokeDasharray="2 6" />
            <XAxis
              dataKey="date"
              stroke="#71717a"
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              tickFormatter={(v) => {
                const d = new Date(v);
                return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke="#71717a"
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              tickFormatter={(v) =>
                v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
              }
              width={48}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: '#ffffff08' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const p = payload[0]?.payload as TrendPoint | undefined;
                if (!p) return null;
                const d = new Date(p.date);
                const dateLabel = d.toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                });
                return (
                  <div className="rounded-lg border border-[--color-border-strong] bg-[--color-surface-3] px-3 py-2 text-xs shadow-2xl">
                    <div className="mb-1.5 text-[11px] font-medium text-[--color-text]">{dateLabel}</div>
                    <div className="flex flex-col gap-0.5 font-mono-num">
                      <Row label="Revenue" value={fmt.usd(p.revenue)} color="text-[--color-accent-revenue]" />
                      <Row label="Impressions" value={fmt.num(p.impressions)} color="text-[--color-accent-impressions]" />
                      <Row label="eCPM" value={fmt.ecpm(p.ecpm)} color="text-[--color-accent-ecpm]" />
                      <Row label="Clicks" value={fmt.num(p.clicks)} color="text-[--color-accent-clicks]" />
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {points.map((p) => (
                <Cell key={p.date} fill={p.revenue >= avg ? '#10b981' : '#10b98180'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="h-[82%] flex items-center justify-center text-sm text-[--color-text-muted]">
      {label}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[--color-text-muted]">{label}</span>
      <span className={color}>{value}</span>
    </div>
  );
}
