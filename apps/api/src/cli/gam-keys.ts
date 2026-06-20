/**
 * One-shot CLI: fetch the GAM-internal numeric IDs for our 5 custom targeting keys.
 *
 *   pnpm --filter @gam/api gam:keys
 *
 * Output is a single line you paste into .env:
 *   GAM_CUSTOM_KEY_IDS=campaign:14823901,source:14823902,...
 *
 * Re-run only if you change the configured key names in GAM. The IDs are
 * stable as long as the GAM key entries aren't deleted/recreated.
 */
import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../../.env') });
loadEnv({ path: path.resolve(here, '../../.env'), override: true });

const KEY_NAMES = ['campaign', 'source', 'headline', 'lander', 'image'] as const;
const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/CustomTargetingService`;
const APP_NAME = 'GAM Arbitrage Dashboard';
const NETWORK_CODE = process.env.GAM_NETWORK_CODE;
const REFRESH_TOKEN_PATH = path.resolve(here, '../../../../secrets/gam-user-refresh-token.json');

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GAM_USER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GAM_USER_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing GAM_USER_OAUTH_CLIENT_ID/SECRET in .env');

  let refreshToken = process.env.GAM_USER_OAUTH_REFRESH_TOKEN;
  if (!refreshToken) {
    const raw = await fs.readFile(REFRESH_TOKEN_PATH, 'utf-8');
    refreshToken = (JSON.parse(raw) as { refresh_token?: string }).refresh_token;
    if (!refreshToken) throw new Error('refresh_token missing in token file');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');
  return token;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  if (!NETWORK_CODE) throw new Error('Missing GAM_NETWORK_CODE in .env');

  console.log(`🔍 Fetching custom targeting keys from GAM (network ${NETWORK_CODE})...\n`);

  // Fetch ALL custom targeting keys (no filter) — easier to debug naming mismatches.
  const pqlQuery = `LIMIT 500`;

  const body = `<ns:getCustomTargetingKeysByStatement>
    <ns:filterStatement>
      <ns:query>${xmlEscape(pqlQuery)}</ns:query>
    </ns:filterStatement>
  </ns:getCustomTargetingKeysByStatement>`;

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header>
    <ns:RequestHeader>
      <ns:networkCode>${xmlEscape(NETWORK_CODE)}</ns:networkCode>
      <ns:applicationName>${xmlEscape(APP_NAME)}</ns:applicationName>
    </ns:RequestHeader>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;

  const token = await getAccessToken();
  const res = await fetch(SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: 'getCustomTargetingKeysByStatement',
      Authorization: `Bearer ${token}`,
    },
    body: envelope,
  });
  const text = await res.text();

  if (!res.ok || /<faultstring/.test(text)) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
    console.error(`❌ GAM SOAP failed: HTTP ${res.status}`);
    console.error(`   ${fault ?? text.slice(0, 300)}`);
    process.exit(1);
  }

  // The SOAP response carries <results><id>123</id><name>campaign</name>...
  const results = [...text.matchAll(/<results>([\s\S]*?)<\/results>/g)].map((m) => m[1]!);
  const keys: Record<string, string> = {};
  for (const r of results) {
    const id = /<id>([^<]+)<\/id>/.exec(r)?.[1];
    const name = /<name>([^<]+)<\/name>/.exec(r)?.[1];
    if (id && name) keys[name] = id;
  }

  // Build a case-insensitive lookup: lowercase → { gamName, id }
  const lookup: Record<string, { gamName: string; id: string }> = {};
  for (const [name, id] of Object.entries(keys)) {
    lookup[name.toLowerCase()] = { gamName: name, id };
  }

  console.log(`✓ Found ${Object.keys(keys).length} total custom targeting key(s) in your GAM network:\n`);
  for (const name of Object.keys(keys).sort()) {
    const isExpected = (KEY_NAMES as readonly string[]).includes(name.toLowerCase());
    const flag = isExpected ? '  ← expected (case-insensitive match)' : '';
    console.log(`  ${name.padEnd(20)} : ${keys[name]}${flag}`);
  }
  console.log('');
  const missing: string[] = [];
  console.log(`🎯 Matching our expected names (case-insensitive):\n`);
  for (const expected of KEY_NAMES) {
    const hit = lookup[expected.toLowerCase()];
    if (hit) {
      console.log(`  ✅ ${expected.padEnd(10)} → GAM key "${hit.gamName}" (id ${hit.id})`);
    } else {
      missing.push(expected);
      console.log(`  ❌ ${expected.padEnd(10)} : NOT FOUND`);
    }
  }
  console.log('');
  if (missing.length > 0) {
    console.log(`⚠️  ${missing.length} key(s) missing from GAM. Either:`);
    console.log(`    a) Have your TL create them in GAM Admin → Inventory → Key-values, or`);
    console.log(`    b) Edit KEY_NAMES in src/cli/gam-keys.ts to match what your GAM actually has.\n`);
  }

  const present = KEY_NAMES.filter((n) => lookup[n.toLowerCase()]);
  if (present.length === 0) {
    console.log('❌ No usable IDs to write. Aborting.');
    process.exit(2);
  }

  // env value uses our canonical lowercase names paired with GAM's actual IDs.
  const envValue = present.map((n) => `${n}:${lookup[n.toLowerCase()]!.id}`).join(',');
  console.log('✅ Add this line to your .env (single line, comma-separated):\n');
  console.log(`   GAM_CUSTOM_KEY_IDS=${envValue}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
