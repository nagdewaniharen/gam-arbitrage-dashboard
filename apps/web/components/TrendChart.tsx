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
              contentStyle={{
                background: '#1b1f27',
                border: '1px solid #2f3540',
                borderRadius: 8,
                fontSize: 12,
                padding: '8px 10px',
              }}
              labelStyle={{ color: '#e7e7ea', marginBottom: 4, fontSize: 11 }}
              formatter={(value: number) => [fmt.usd(value), 'Revenue']}
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
