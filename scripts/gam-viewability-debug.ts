/**
 * Prints the FULL raw runReportJob response when requesting viewability/match_rate,
 * so we can see if GAM rejects the columns (and why) vs silently dropping them.
 * Also tries alternate column-name spellings.
 *
 * Run from apps/api:
 *   cp scripts/gam-viewability-debug.ts apps/api/
 *   cd apps/api
 *   node --env-file=../../.env --experimental-strip-types gam-viewability-debug.ts
 *   rm gam-viewability-debug.ts
 */
// @ts-nocheck
import { google } from 'googleapis';

const VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const NS = `https://www.google.com/apis/ads/publisher/${VERSION}`;
const URL_ = `https://ads.google.com/apis/ads/publisher/${VERSION}/ReportService`;
const NETWORK = process.env.GAM_NETWORK_CODE!;

async function token() {
  const o = new google.auth.OAuth2(process.env.GAM_OAUTH_CLIENT_ID, process.env.GAM_OAUTH_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GAM_OAUTH_REFRESH_TOKEN });
  const { token } = await o.getAccessToken();
  return token!;
}
function d(tag: string, dt: Date) {
  return `<ns:${tag}><ns:year>${dt.getUTCFullYear()}</ns:year><ns:month>${dt.getUTCMonth()+1}</ns:month><ns:day>${dt.getUTCDate()}</ns:day></ns:${tag}>`;
}
async function soap(action: string, body: string, tok: string) {
  const env = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${NS}">
  <soap:Header><ns:RequestHeader><ns:networkCode>${NETWORK}</ns:networkCode><ns:applicationName>vdebug</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL_, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8', SOAPAction:action, Authorization:`Bearer ${tok}`}, body: env });
  return { status: res.status, text: await res.text() };
}

async function tryColumns(label: string, cols: string[], tok: string) {
  console.log(`\n========== ${label} ==========`);
  const to = new Date();
  const from = new Date(Date.now() - 30*86400000);
  const colXml = cols.map(c => `<ns:columns>${c}</ns:columns>`).join('');
  const query = `<ns:dimensions>DATE</ns:dimensions>${colXml}${d('startDate',from)}${d('endDate',to)}<ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>`;
  const run = await soap('runReportJob', `<ns:runReportJob><ns:reportJob><ns:reportQuery>${query}</ns:reportQuery></ns:reportJob></ns:runReportJob>`, tok);
  console.log('HTTP status:', run.status);
  if (run.status !== 200) {
    // print fault + any ApiError details
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(run.text)?.[1];
    console.log('faultstring:', fault);
    // ApiError reasons often in <errors> or <ApiException>
    const reasons = [...run.text.matchAll(/<reason>([\s\S]*?)<\/reason>/g)].map(m=>m[1]);
    const fields = [...run.text.matchAll(/<fieldPath>([\s\S]*?)<\/fieldPath>/g)].map(m=>m[1]);
    const triggers = [...run.text.matchAll(/<trigger>([\s\S]*?)<\/trigger>/g)].map(m=>m[1]);
    if (reasons.length) console.log('reasons:', reasons);
    if (fields.length) console.log('fieldPaths:', fields);
    if (triggers.length) console.log('triggers:', triggers);
    console.log('--- raw (first 1500 chars) ---');
    console.log(run.text.slice(0, 1500));
  } else {
    console.log('ACCEPTED ✓ (job created). The columns above are valid for this network/version.');
  }
}

async function main() {
  const tok = await token();

  // 1. Confirm baseline still accepted
  await tryColumns('1: baseline (impr+rev) — sanity', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
  ], tok);

  // 2. viewability AD_EXCHANGE_LINE_ITEM_LEVEL spelling
  await tryColumns('2: + AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS',
  ], tok);

  // 3. alternate viewability name (AD_SERVER / total)
  await tryColumns('3: + AD_EXCHANGE_TOTAL_REQUEST_ECPM? no — try AD_EXCHANGE_LINE_ITEM_LEVEL_MATCHED_REQUESTS', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_MATCHED_REQUESTS',
  ], tok);

  // 4. generic AdExchange viewability (not line-item-level)
  await tryColumns('4: + AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE',
  ], tok);

  // 5. match rate variants
  await tryColumns('5: + AD_EXCHANGE_MATCH_RATE (non line-item)', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_MATCH_RATE',
  ], tok);

  // 6. requests variant
  await tryColumns('6: + AD_EXCHANGE_LINE_ITEM_LEVEL_TOTAL_REQUESTS', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_TOTAL_REQUESTS',
  ], tok);
}
main().catch(e => console.error('ERROR', e.message));