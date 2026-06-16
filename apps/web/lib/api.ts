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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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

export const api = {
  stats: (period: Period) => get<StatsResponse>(`/api/stats?period=${period}`),
  trend: (period: Period) => get<TrendResponse>(`/api/trend?period=${period}`),
  breakdown: (dim: Dimension, period: Period, limit = 25) =>
    get<BreakdownResponse>(`/api/breakdown/${dim}?period=${period}&limit=${limit}`),
  performers: (type: 'top' | 'bottom', by: Dimension, period: Period, limit = 10) =>
    get<PerformersResponse>(`/api/performers/${type}?by=${by}&period=${period}&limit=${limit}`),
  cross: (dim1: Dimension, dim2: Dimension, period: Period, limit = 100) =>
    get<CrossResponse>(`/api/cross/${dim1}/${dim2}?period=${period}&limit=${limit}`),
  status: () => get<StatusResponse>(`/api/status`),
};
