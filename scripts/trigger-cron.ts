/**
 * Calls the HMAC-protected /internal/cron/refresh endpoint — exactly as AWS
 * EventBridge would. Use it to (A) test the cron endpoint works, or (B) run
 * from a local Mac cron job for real hourly auto-refresh.
 *
 * Reads INTERNAL_CRON_SECRET from .env (same value the API uses, so they match).
 *
 * Run from apps/api:
 *   cp scripts/trigger-cron.ts apps/api/
 *   cd apps/api
 *   node --env-file=../../.env --experimental-strip-types trigger-cron.ts
 *   rm trigger-cron.ts
 */
// @ts-nocheck
import crypto from 'node:crypto';

const API_BASE = process.env.CRON_TARGET_URL ?? 'http://localhost:4000';
const SECRET = process.env.INTERNAL_CRON_SECRET ?? '';
if (!SECRET) { console.error('INTERNAL_CRON_SECRET not set in env'); process.exit(1); }

// Body: empty {} uses the API's default incremental days. Or set daysBack.
const body = JSON.stringify({});

// Sign exactly like signCronPayload() in apps/api/src/lib/hmac.ts
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature =
  'sha256=' + crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');

const url = `${API_BASE}/internal/cron/refresh`;
console.log(`[${new Date().toISOString()}] POST ${url}`);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Cron-Signature': signature,
    'X-Cron-Timestamp': timestamp,
  },
  body,
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);
if (!res.ok) process.exit(1);