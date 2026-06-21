#!/usr/bin/env node
// Render cron entry point — replaces the local launchd job.
// Computes HMAC-SHA256 over `${timestamp}.${body}` (same contract as
// apps/api/src/lib/hmac.ts) and POSTs to /internal/cron/refresh.
//
// Env vars (set by render.yaml):
//   INTERNAL_CRON_SECRET — shared secret (referenced from gam-api service)
//   API_URL              — public URL of gam-api (e.g., https://gam-api.onrender.com)

import crypto from 'node:crypto';

const API_URL = process.env.API_URL;
const SECRET = process.env.INTERNAL_CRON_SECRET;

if (!API_URL || !SECRET) {
  console.error('Missing env: API_URL and INTERNAL_CRON_SECRET are required');
  process.exit(1);
}

const body = JSON.stringify({});
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature =
  'sha256=' + crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');

const url = `${API_URL.replace(/\/$/, '')}/internal/cron/refresh`;
const started = Date.now();

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-cron-signature': signature,
    'x-cron-timestamp': timestamp,
  },
  body,
});

const text = await res.text();
const elapsed = Date.now() - started;

console.log(JSON.stringify({ url, status: res.status, elapsedMs: elapsed, response: text.slice(0, 500) }));

if (!res.ok) process.exit(1);
