'use client';

import { useMemo, useRef, useState } from 'react';
import type { TrendPoint } from '@gam/types';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * PRD §9.3.3 — Daily Revenue Trend.
 * Raw SVG bar chart. Sharp at any size, matches the Recharts visual we had
 * before, but zero library overhead (PRD "no heavy chart library needed").
 *
 * Hover any bar → tooltip with date / revenue / impressions / eCPM / clicks
 * (PRD §9.3.3 tooltip contract). Above-/below-average bars colored
 * differently. Y-axis "nice" ticks + dashed gridlines.
 */
export function TrendChart({ points, loading }: { points: TrendPoint[]; loading?: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { avg, total, max } = useMemo(() => {
    if (points.length === 0) return { avg: 0, total: 0, max: 0 };
    const sum = points.reduce((a, p) => a + p.revenue, 0);
    const m = points.reduce((a, p) => (p.revenue > a ? p.revenue : a), 0);
    return { avg: sum / points.length, total: sum, max: m };
  }, [points]);

  const yMax = useMemo(() => niceUpper(max), [max]);
  const yTicks = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f)), [yMax]);

  // SVG layout — viewBox uses logical 1000×400 units that scale via CSS.
  const VBW = 1000;
  const VBH = 400;
  const PAD_L = 56;
  const PAD_R = 12;
  const PAD_T = 8;
  // PAD_B reserves space at the bottom of the SVG for the X-axis date
  // labels (rendered as an HTML overlay below). Must be > the label height
  // or bars visually overlap the dates.
  const PAD_B = 60;
  const innerW = VBW - PAD_L - PAD_R;
  const innerH = VBH - PAD_T - PAD_B;

  // Bar geometry — equal-width bands, 70% bar / 30% gap.
  const band = points.length > 0 ? innerW / points.length : 0;
  const barW = band * 0.7;

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
        <div ref={wrapRef} className="relative h-[82%] w-full">
          <svg viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="none" className="w-full h-full block">
            {/* Gridlines */}
            {yTicks.map((t, i) => {
              const y = PAD_T + innerH - (t / yMax) * innerH;
              return (
                <line
                  key={`grid-${i}`}
                  x1={PAD_L}
                  x2={VBW - PAD_R}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeDasharray="3 6"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Y-axis tick labels — fixed text size via vector-effect trick won't help, so we render text in screen-px after CSS scaling: use a separate HTML overlay below */}

            {/* Bars */}
            {points.map((p, i) => {
              const x = PAD_L + i * band + (band - barW) / 2;
              const h = yMax > 0 ? Math.max((p.revenue / yMax) * innerH, p.revenue > 0 ? 2 : 0) : 0;
              const y = PAD_T + innerH - h;
              const above = p.revenue >= avg;
              const isActive = hoverIdx === i;
              const fill = above ? 'var(--color-accent-revenue)' : 'var(--color-accent-revenue)';
              return (
                <g key={p.date}>
                  {/* Invisible wide hit-area for easier hover */}
                  <rect
                    x={PAD_L + i * band}
                    y={PAD_T}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                  />
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={4}
                    ry={4}
                    fill={fill}
                    opacity={above ? (isActive ? 1 : 0.95) : isActive ? 0.7 : 0.45}
                    style={{ transition: 'opacity 120ms ease' }}
                  />
                  {isActive ? (
                    <rect
                      x={x - 1}
                      y={y - 1}
                      width={barW + 2}
                      height={h + 2}
                      rx={5}
                      ry={5}
                      fill="none"
                      stroke="var(--color-accent-revenue)"
                      strokeOpacity={0.6}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/* HTML overlay for axis labels — keeps text crisp (SVG text would distort with preserveAspectRatio="none") */}
          <div className="pointer-events-none absolute inset-0">
            {/* Y-axis labels — align with SVG plot area (top: 2px / bottom: PAD_B-as-px ≈ 39px) */}
            <div className="absolute left-0 top-1 w-[56px] flex flex-col-reverse justify-between text-right pr-2 text-[10px] text-[--color-text-muted] font-mono-num" style={{ bottom: '15%' }}>
              {yTicks.map((t, i) => (
                <span key={i} className="leading-none">
                  {t >= 1000 ? `$${(t / 1000).toFixed(1)}k` : `$${t}`}
                </span>
              ))}
            </div>
            {/* X-axis labels — sit in the PAD_B band below the bars */}
            <div className="absolute left-[56px] right-[12px] bottom-0 h-[12%] flex items-start">
              {points.map((p, i) => {
                const skip = points.length > 8 && i % Math.ceil(points.length / 8) !== 0 && i !== points.length - 1;
                const d = new Date(p.date);
                const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                return (
                  <div
                    key={p.date}
                    className="flex-1 text-[10px] text-[--color-text-muted] text-center font-mono-num leading-none mt-1"
                  >
                    {skip ? '' : label}
                  </div>
                );
              })}
            </div>
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
  const positionRight = idx > total / 2;
  return (
    <div
      className={cn(
        'pointer-events-none absolute -top-1 z-10 rounded-lg border border-[--color-border-strong] bg-[--color-surface-3] px-3 py-2 text-xs shadow-2xl min-w-[180px]',
        positionRight ? 'right-2' : 'left-[60px]',
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
