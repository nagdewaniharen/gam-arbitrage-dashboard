import type { Period } from '@gam/types';

/**
 * Returns { from, to } as YYYY-MM-DD strings in the GAM report timezone (IST).
 * `today` = today only
 * `7d`    = last 7 days inclusive of today
 * `30d`   = last 30 days inclusive of today
 * `all`   = null bounds → caller should treat as no-filter
 */
export function periodToDateRange(period: Period): { from: Date | null; to: Date | null } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (period === 'all') return { from: null, to: today };

  const to = today;
  const from = new Date(today);
  if (period === 'today') {
    return { from: to, to };
  }
  if (period === '7d') {
    from.setUTCDate(from.getUTCDate() - 6);
    return { from, to };
  }
  if (period === '30d') {
    from.setUTCDate(from.getUTCDate() - 29);
    return { from, to };
  }
  return { from: null, to };
}

/**
 * Resolve a `?period=...` OR `?from=YYYY-MM-DD&to=YYYY-MM-DD` request into a
 * { from, to } range. Custom dates take precedence over the period preset.
 */
export function resolveDateRange(args: {
  period?: Period;
  from?: string;
  to?: string;
}): { from: Date | null; to: Date | null; isCustom: boolean } {
  if (args.from && args.to) {
    const from = new Date(args.from + 'T00:00:00Z');
    const to = new Date(args.to + 'T00:00:00Z');
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { from, to, isCustom: true };
    }
  }
  const r = periodToDateRange((args.period ?? '7d') as Period);
  return { ...r, isCustom: false };
}

export function previousPeriodRange(period: Period): { from: Date | null; to: Date | null } {
  const { from, to } = periodToDateRange(period);
  if (!from || !to || period === 'all') return { from: null, to: null };

  const days =
    Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));

  return { from: prevFrom, to: prevTo };
}
