// Shared types used by both apps/api and apps/web.
// Keep this surface small — anything DB-specific belongs in @gam/db.

export type Period = 'today' | '7d' | '30d' | 'all';

export type Dimension =
  | 'campaign'
  | 'source'
  | 'headline'
  | 'lander'
  | 'image'
  | 'ad_unit'
  | 'site'
  | 'country'
  | 'page'
  | 'date';

export const VALID_DIMENSIONS: readonly Dimension[] = [
  'campaign',
  'source',
  'headline',
  'lander',
  'image',
  'ad_unit',
  'site',
  'country',
  'page',
  'date',
] as const;

export interface StatsResponse {
  period: Period;
  totalRevenue: number;
  totalImpressions: number;
  totalClicks: number;
  avgEcpm: number;
  ctr: number;
  viewability: number;
  matchRate: number;
  previousPeriod?: {
    totalRevenue: number;
    totalImpressions: number;
    avgEcpm: number;
    changes: {
      revenuePct: number;
      impressionsPct: number;
      ecpmPct: number;
    };
  };
}

export interface BreakdownRow {
  name: string;
  impressions: number;
  clicks: number;
  revenue: number;
  ecpm: number;
  ctr: number;
}

export interface BreakdownResponse {
  period: Period;
  dimension: Dimension;
  rows: BreakdownRow[];
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  impressions: number;
  clicks: number;
  ecpm: number;
}

export interface TrendResponse {
  period: Period;
  points: TrendPoint[];
}

export interface CrossRow {
  dim1: string;
  dim2: string;
  impressions: number;
  clicks: number;
  revenue: number;
  ecpm: number;
  ctr: number;
}

export interface CrossResponse {
  period: Period;
  dim1: Dimension;
  dim2: Dimension;
  rows: CrossRow[];
}

export interface PerformerRow extends BreakdownRow {
  rank: number;
}

export interface PerformersResponse {
  period: Period;
  by: Dimension;
  type: 'top' | 'bottom';
  rows: PerformerRow[];
  minImpressions: number;
}

export interface StatusResponse {
  ok: boolean;
  lastSuccessfulCronAt: string | null;
  lastCronStatus: 'running' | 'succeeded' | 'failed' | null;
  totalRows: number;
  databaseUp: boolean;
  buildSha?: string;
  generatedAt: string;
}

export interface SitesResponse {
  sites: string[];
}

export interface CountriesResponse {
  countries: string[];
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta: {
    generatedAt: string;
    period?: Period;
  };
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
