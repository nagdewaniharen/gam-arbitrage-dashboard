import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';

type Accent = 'revenue' | 'impressions' | 'ecpm' | 'clicks' | 'viewability' | 'matchRate';

// Raw hex values — applied via inline style so tailwind-merge can't strip
// them (it was incorrectly deduping our `text-[--color-*]` arbitrary
// classes against the font-size `text-[28px]` utility).
const ACCENT_COLOR: Record<Accent, string> = {
  revenue: '#10b981',
  impressions: '#60a5fa',
  ecpm: '#f59e0b',
  clicks: '#a78bfa',
  viewability: '#f59e0b',
  matchRate: '#60a5fa',
};

export function KpiCard({
  label,
  value,
  sub,
  accent,
  changePct,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: Accent;
  changePct?: number;
  loading?: boolean;
}) {
  const isUp = (changePct ?? 0) >= 0;
  const hasChange = typeof changePct === 'number' && !loading;
  const color = ACCENT_COLOR[accent];
  return (
    <div
      className="card flex flex-col gap-2 min-h-[118px]"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        {label}
      </div>
      {loading ? (
        <div className="h-9 w-32 rounded bg-[--color-surface-2] animate-pulse" />
      ) : (
        // accent === 'clicks' stays neutral white per PRD wireframe; everything
        // else gets the per-metric color.
        <div
          className="text-[28px] leading-tight font-bold font-mono-num"
          style={accent === 'clicks' ? undefined : { color }}
        >
          {value}
        </div>
      )}
      {sub ? <div className="text-xs text-[--color-text-dim]">{sub}</div> : null}
      {hasChange ? (
        <div
          className={cn(
            'inline-flex items-center gap-1 text-xs font-mono-num',
            isUp ? 'text-[--color-success]' : 'text-[--color-danger]',
          )}
        >
          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(changePct!).toFixed(1)}%
          <span className="text-[--color-text-muted] font-sans ml-1">vs previous</span>
        </div>
      ) : null}
    </div>
  );
}
