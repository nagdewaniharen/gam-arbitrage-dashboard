import crypto from 'node:crypto';

/**
 * Constant-time HMAC-SHA256 signature verification.
 * EventBridge Scheduler (or any caller) must compute:
 *   sig = HMAC-SHA256(secret, timestamp + "." + body)
 * and send as `X-Cron-Signature: sha256=<hex>`, plus `X-Cron-Timestamp`.
 *
 * Replay-protection: timestamps older than 5 minutes are rejected.
 */
export function verifyCronSignature(opts: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  toleranceSec?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, timestamp, body, signature, toleranceSec = 300 } = opts;
  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > toleranceSec) return { ok: false, reason: 'expired' };

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return { ok: false, reason: 'len_mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

export function signCronPayload(secret: string, body: string): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { timestamp, signature };
}
