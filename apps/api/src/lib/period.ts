import type { Period } from '@gam/types';

/**
 * Returns { from, to } in the GAM report timezone (IST).
 *
 * Window conventions match GAM Ad Manager UI exactly (which always ends
 * windows yesterday because today is incomplete):
 *   `today` = today only (the one period that DOES include today)
 *   `7d`    = last 7 complete days ending yesterday
 *   `30d`   = last 30 complete days ending yesterday
 *   `all`   = null bounds → caller treats as no-filter
 */
export function periodToDateRange(period: Period): { from: Date | null; to: Date | null } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (period === 'all') return { from: null, to: today };

  if (period === 'today') {
    return { from: today, to: today };
  }

  // Multi-day windows end YESTERDAY (today is partial). This is how GAM UI
  // computes its "Last 7 days" / "Last 30 days" tabs.
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const from = new Date(yesterday);
  if (period === '7d') {
    from.setUTCDate(from.getUTCDate() - 6); // yesterday + 6 days back = 7 total
    return { from, to: yesterday };
  }
  if (period === '30d') {
    from.setUTCDate(from.getUTCDate() - 29); // yesterday + 29 days back = 30 total
    return { from, to: yesterday };
  }
  return { from: null, to: yesterday };
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
