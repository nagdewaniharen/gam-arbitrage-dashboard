import type { ApiSuccess, ApiError, Period } from '@gam/types';

export function ok<T>(data: T, period?: Period): ApiSuccess<T> {
  return {
    ok: true,
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      ...(period ? { period } : {}),
    },
  };
}

export function err(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, details } };
}
