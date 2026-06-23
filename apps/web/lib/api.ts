import type {
  ApiResponse,
  BreakdownResponse,
  CrossResponse,
  Dimension,
  PerformersResponse,
  Period,
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

/** Build a `?period=...` OR `?from=...&to=...` query string. */
function rangeQuery(period: Period, range?: DateRange | null): string {
  if (range) return `from=${range.from}&to=${range.to}`;
  return `period=${period}`;
}

export const api = {
  stats: (period: Period, range?: DateRange | null) =>
    get<StatsResponse>(`/api/stats?${rangeQuery(period, range)}`),
  trend: (period: Period, range?: DateRange | null) =>
    get<TrendResponse>(`/api/trend?${rangeQuery(period, range)}`),
  breakdown: (dim: Dimension, period: Period, limit = 25, range?: DateRange | null) =>
    get<BreakdownResponse>(`/api/breakdown/${dim}?${rangeQuery(period, range)}&limit=${limit}`),
  performers: (type: 'top' | 'bottom', by: Dimension, period: Period, limit = 10, range?: DateRange | null) =>
    get<PerformersResponse>(`/api/performers/${type}?by=${by}&${rangeQuery(period, range)}&limit=${limit}`),
  cross: (dim1: Dimension, dim2: Dimension, period: Period, limit = 100, range?: DateRange | null) =>
    get<CrossResponse>(`/api/cross/${dim1}/${dim2}?${rangeQuery(period, range)}&limit=${limit}`),
  status: () => get<StatusResponse>(`/api/status`),
};
