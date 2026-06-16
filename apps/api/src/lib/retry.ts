/**
 * Retry with exponential backoff + jitter, capped at maxDelayMs.
 * Used for all external API calls (GAM, MGID, Slack).
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (err: unknown, attempt: number) => boolean;
    onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    shouldRetry = () => true,
    onRetry,
  } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts || !shouldRetry(e, attempt)) break;
      const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * expo * 0.3;
      const delay = Math.round(expo + jitter);
      onRetry?.(e, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
