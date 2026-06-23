'use client';

import { useMemo, useState } from 'react';
import type { TrendPoint } from '@gam/types';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * PRD §9.3.3 — Daily Revenue Trend.
 * "Canvas-based or CSS bars (no heavy chart library needed)" — implemented
 * with pure CSS flex bars + a React-state hover tooltip. No Recharts.
 *
 * Above-average bars use full opacity in the revenue accent; below-average
 * bars dim to 50% so spikes pop visually. Hover any bar → tooltip shows
 * date, revenue, impressions, eCPM, clicks (PRD §9.3.3 tooltip contract).
 */
export function TrendChart({ points, loading }: { points: TrendPoint[]; loading?: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { avg, total, max } = useMemo(() => {
    if (points.length === 0) return { avg: 0, total: 0, max: 0 };
    const sum = points.reduce((a, p) => a + p.revenue, 0);
    const m = points.reduce((a, p) => (p.revenue > a ? p.revenue : a), 0);
    return { avg: sum / points.length, total: sum, max: m };
  }, [points]);

  const yTicks = useMemo(() => {
    if (max <= 0) return [0];
    // Five evenly spaced ticks rounded to a clean value above max
    const niceMax = niceUpper(max);
    return [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map((v) => Math.round(v));
  }, [max]);
  const yMax = yTicks[yTicks.length - 1] ?? max;

  return (
    <div className="card h-80">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Revenue Trend
          </div>
          {!loading && points.length > 0 ? (
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
        <div className="h-[82%] flex items-center justify-center text-sm text-[--color-text-muted]">
          No data for this period
        </div>
      ) : (
        <div className="relative h-[82%] flex pl-12 pr-1 pb-6 pt-1">
          {/* Y-axis ticks + gridlines */}
          <div className="absolute left-0 top-1 bottom-6 w-12 flex flex-col-reverse justify-between text-right pr-2 text-[10px] text-[--color-text-muted] font-mono-num">
            {yTicks.map((t, i) => (
              <span key={i} className="leading-none">
                {t >= 1000 ? `$${(t / 1000).toFixed(1)}k` : `$${t}`}
              </span>
            ))}
          </div>
          <div className="absolute left-12 right-1 top-1 bottom-6 flex flex-col-reverse justify-between pointer-events-none">
            {yTicks.map((_, i) => (
              <div key={i} className="border-t border-dashed border-[--color-border]/60" />
            ))}
          </div>

          {/* Bars */}
          <div className="relative flex-1 flex items-end gap-1 sm:gap-2">
            {points.map((p, i) => {
              const heightPct = yMax > 0 ? Math.max((p.revenue / yMax) * 100, p.revenue > 0 ? 1.5 : 0) : 0;
              const isActive = hoverIdx === i;
              return (
                <div
                  key={p.date}
                  className="relative flex-1 flex flex-col items-center justify-end h-full group cursor-pointer"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                >
                  <div
                    className={cn(
                      'w-full rounded-t transition-all duration-150',
                      isActive ? 'opacity-100 ring-1 ring-[--color-accent-revenue]/40' : '',
                      p.revenue >= avg
                        ? 'bg-[--color-accent-revenue]'
                        : 'bg-[--color-accent-revenue]/45',
                    )}
                    style={{ height: `${heightPct}%`, minHeight: p.revenue > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>

          {/* X-axis date labels — show ~6 evenly spaced */}
          <div className="absolute left-12 right-1 bottom-0 h-5 flex gap-1 sm:gap-2 pointer-events-none">
            {points.map((p, i) => {
              const skip = points.length > 8 && i % Math.ceil(points.length / 8) !== 0 && i !== points.length - 1;
              const d = new Date(p.date);
              const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              return (
                <div key={p.date} className="flex-1 text-[10px] text-[--color-text-muted] text-center font-mono-num leading-none mt-1">
                  {skip ? '' : label}
                </div>
              );
            })}
          </div>

          {/* Tooltip */}
          {hoverIdx !== null && points[hoverIdx] ? (
            <Tooltip point={points[hoverIdx]} idx={hoverIdx} total={points.length} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Tooltip({ point, idx, total }: { point: TrendPoint; idx: number; total: number }) {
  const d = new Date(point.date);
  const dateLabel = d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  // Anchor right or left so the tooltip doesn't run off the chart edge
  const positionRight = idx > total / 2;
  return (
    <div
      className={cn(
        'pointer-events-none absolute -top-2 z-10 rounded-lg border border-[--color-border-strong] bg-[--color-surface-3] px-3 py-2 text-xs shadow-2xl min-w-[180px]',
        positionRight ? 'right-2' : 'left-14',
      )}
    >
      <div className="mb-1.5 text-[11px] font-medium text-[--color-text]">{dateLabel}</div>
      <div className="flex flex-col gap-0.5 font-mono-num">
        <Row label="Revenue" value={fmt.usd(point.revenue)} color="text-[--color-accent-revenue]" />
        <Row label="Impressions" value={fmt.num(point.impressions)} color="text-[--color-accent-impressions]" />
        <Row label="eCPM" value={fmt.ecpm(point.ecpm)} color="text-[--color-accent-ecpm]" />
        <Row label="Clicks" value={fmt.num(point.clicks)} color="text-[--color-accent-clicks]" />
      </div>
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

/** Round a number up to a "nice" axis maximum (1, 2, 5 × 10^n). */
function niceUpper(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const f = n / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}
