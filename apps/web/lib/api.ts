import type {
  ApiResponse,
  BreakdownResponse,
  CrossResponse,
  Dimension,
  PerformersResponse,
  Period,
  SitesResponse,
  StatsResponse,
  StatusResponse,
  TrendResponse,
} from '@gam/types';

// In production / when accessed from a non-local host, we proxy API calls
// through the Next.js server via `/api-proxy/*` (configured in next.config.mjs).
// `process.env.NEXT_PUBLIC_API_URL` is only used in local dev (set to
// http://localhost:4000 in .env). Empty string → same-origin relative URLs.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) ${path}`);
  }
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) {
    throw new Error(`${body.error.code}: ${body.error.message}`);
  }
  return body.data;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

/**
 * Build a `?period=...&sites=a,b` OR `?from=...&to=...&sites=a,b` query string.
 * `sites` is omitted entirely when empty so routes see "all sites".
 */
function rangeQuery(period: Period, range?: DateRange | null, sites?: string[]): string {
  const base = range ? `from=${range.from}&to=${range.to}` : `period=${period}`;
  if (!sites || sites.length === 0) return base;
  return `${base}&sites=${encodeURIComponent(sites.join(','))}`;
}

export const api = {
  stats: (period: Period, range?: DateRange | null, sites?: string[]) =>
    get<StatsResponse>(`/api/stats?${rangeQuery(period, range, sites)}`),
  trend: (period: Period, range?: DateRange | null, sites?: string[]) =>
    get<TrendResponse>(`/api/trend?${rangeQuery(period, range, sites)}`),
  breakdown: (dim: Dimension, period: Period, limit = 25, range?: DateRange | null, sites?: string[]) =>
    get<BreakdownResponse>(`/api/breakdown/${dim}?${rangeQuery(period, range, sites)}&limit=${limit}`),
  performers: (type: 'top' | 'bottom', by: Dimension, period: Period, limit = 10, range?: DateRange | null, sites?: string[]) =>
    get<PerformersResponse>(`/api/performers/${type}?by=${by}&${rangeQuery(period, range, sites)}&limit=${limit}`),
  cross: (dim1: Dimension, dim2: Dimension, period: Period, limit = 100, range?: DateRange | null, sites?: string[]) =>
    get<CrossResponse>(`/api/cross/${dim1}/${dim2}?${rangeQuery(period, range, sites)}&limit=${limit}`),
  sites: () => get<SitesResponse>(`/api/sites`),
  status: () => get<StatusResponse>(`/api/status`),
};
