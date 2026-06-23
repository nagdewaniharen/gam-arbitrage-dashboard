import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';

type Accent = 'revenue' | 'impressions' | 'ecpm' | 'clicks' | 'viewability' | 'matchRate';

const ACCENT_DOT: Record<Accent, string> = {
  revenue: 'bg-[--color-accent-revenue]',
  impressions: 'bg-[--color-accent-impressions]',
  ecpm: 'bg-[--color-accent-ecpm]',
  clicks: 'bg-[--color-accent-clicks]',
  viewability: 'bg-[--color-accent-ecpm]',
  matchRate: 'bg-[--color-accent-impressions]',
};

// PRD §10.3.1 — Revenue green, Impressions blue, eCPM yellow, Clicks neutral.
const ACCENT_TEXT: Record<Accent, string> = {
  revenue: 'text-[--color-accent-revenue]',
  impressions: 'text-[--color-accent-impressions]',
  ecpm: 'text-[--color-accent-ecpm]',
  clicks: 'text-[--color-text]',
  viewability: 'text-[--color-accent-ecpm]',
  matchRate: 'text-[--color-accent-impressions]',
};

// Left-edge stripe — makes the accent unmistakable even from across the room.
const ACCENT_STRIPE: Record<Accent, string> = {
  revenue: 'before:bg-[--color-accent-revenue]',
  impressions: 'before:bg-[--color-accent-impressions]',
  ecpm: 'before:bg-[--color-accent-ecpm]',
  clicks: 'before:bg-[--color-accent-clicks]',
  viewability: 'before:bg-[--color-accent-ecpm]',
  matchRate: 'before:bg-[--color-accent-impressions]',
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
    <div
      className={cn(
        // Accent stripe via a ::before pseudo-element so we don't touch the card padding.
        'card relative flex flex-col gap-2 min-h-[118px] overflow-hidden',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1',
        ACCENT_STRIPE[accent],
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', ACCENT_DOT[accent])} />
        {label}
      </div>
      {loading ? (
        <div className="h-9 w-32 rounded bg-[--color-surface-2] animate-pulse" />
      ) : (
        <div
          className={cn(
            'text-[28px] leading-tight font-bold font-mono-num',
            ACCENT_TEXT[accent],
          )}
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
