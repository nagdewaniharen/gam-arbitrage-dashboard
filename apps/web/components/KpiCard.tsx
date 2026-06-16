import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';

type Accent = 'revenue' | 'impressions' | 'ecpm' | 'clicks';

const ACCENT_DOT: Record<Accent, string> = {
  revenue: 'bg-[--color-accent-revenue]',
  impressions: 'bg-[--color-accent-impressions]',
  ecpm: 'bg-[--color-accent-ecpm]',
  clicks: 'bg-[--color-accent-clicks]',
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
  return (
    <div className="card flex flex-col gap-2 min-h-[118px]">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', ACCENT_DOT[accent])} />
        {label}
      </div>
      {loading ? (
        <div className="h-9 w-32 rounded bg-[--color-surface-2] animate-pulse" />
      ) : (
        <div className="text-[28px] leading-tight font-semibold font-mono-num">{value}</div>
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
