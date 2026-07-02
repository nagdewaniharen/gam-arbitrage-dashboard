import type {
  ApiResponse,
  BreakdownResponse,
  CountriesResponse,
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
 * Build a `?period=...&sites=a,b&countries=x,y` OR `?from=...&to=...` query.
 * `sites`/`countries` are omitted entirely when empty so routes see "all".
 */
function rangeQuery(
  period: Period,
  range?: DateRange | null,
  sites?: string[],
  countries?: string[],
): string {
  let s = range ? `from=${range.from}&to=${range.to}` : `period=${period}`;
  if (sites && sites.length > 0) s += `&sites=${encodeURIComponent(sites.join(','))}`;
  if (countries && countries.length > 0) s += `&countries=${encodeURIComponent(countries.join(','))}`;
  return s;
}

export const api = {
  stats: (period: Period, range?: DateRange | null, sites?: string[], countries?: string[]) =>
    get<StatsResponse>(`/api/stats?${rangeQuery(period, range, sites, countries)}`),
  trend: (period: Period, range?: DateRange | null, sites?: string[], countries?: string[]) =>
    get<TrendResponse>(`/api/trend?${rangeQuery(period, range, sites, countries)}`),
  breakdown: (
    dim: Dimension,
    period: Period,
    limit = 25,
    range?: DateRange | null,
    sites?: string[],
    countries?: string[],
  ) =>
    get<BreakdownResponse>(
      `/api/breakdown/${dim}?${rangeQuery(period, range, sites, countries)}&limit=${limit}`,
    ),
  performers: (
    type: 'top' | 'bottom',
    by: Dimension,
    period: Period,
    limit = 10,
    range?: DateRange | null,
    sites?: string[],
    countries?: string[],
  ) =>
    get<PerformersResponse>(
      `/api/performers/${type}?by=${by}&${rangeQuery(period, range, sites, countries)}&limit=${limit}`,
    ),
  cross: (
    dim1: Dimension,
    dim2: Dimension,
    period: Period,
    limit = 100,
    range?: DateRange | null,
    sites?: string[],
    countries?: string[],
  ) =>
    get<CrossResponse>(
      `/api/cross/${dim1}/${dim2}?${rangeQuery(period, range, sites, countries)}&limit=${limit}`,
    ),
  sites: () => get<SitesResponse>(`/api/sites`),
  countries: () => get<CountriesResponse>(`/api/countries`),
  status: () => get<StatusResponse>(`/api/status`),
};
