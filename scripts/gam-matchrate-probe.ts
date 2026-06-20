/**
 * Tests candidate MATCH_RATE / coverage column names + downloads report to see
 * which returns real values. Viewability already confirmed working as
 * AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE.
 *
 * Run from apps/api:
 *   cp scripts/gam-matchrate-probe.ts apps/api/
 *   cd apps/api
 *   node --env-file=../../.env --experimental-strip-types gam-matchrate-probe.ts
 *   rm gam-matchrate-probe.ts
 */
// @ts-nocheck
import { google } from 'googleapis';
import zlib from 'node:zlib';

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
  <soap:Header><ns:RequestHeader><ns:networkCode>${NETWORK}</ns:networkCode><ns:applicationName>mrprobe</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL_, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8', SOAPAction:action, Authorization:`Bearer ${tok}`}, body: env });
  return { status: res.status, text: await res.text() };
}
function tag(xml: string, t: string) { return new RegExp(`<(?:[a-z]+:)?${t}>([^<]+)</(?:[a-z]+:)?${t}>`).exec(xml)?.[1]; }

// Test each candidate ALONE (with impressions) so we can tell exactly which returns data
async function testCol(candidate: string, tok: string) {
  const to = new Date();
  const from = new Date(Date.now() - 30*86400000);
  const cols = ['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS', candidate];
  const colXml = cols.map(c => `<ns:columns>${c}</ns:columns>`).join('');
  const query = `<ns:dimensions>DATE</ns:dimensions>${colXml}${d('startDate',from)}${d('endDate',to)}<ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>`;
  const run = await soap('runReportJob', `<ns:runReportJob><ns:reportJob><ns:reportQuery>${query}</ns:reportQuery></ns:reportJob></ns:runReportJob>`, tok);
  if (run.status !== 200) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(run.text)?.[1];
    return { candidate, result: 'REJECTED', detail: fault?.slice(0,120) };
  }
  const jobId = tag(run.text, 'id') ?? tag(run.text, 'rval');
  if (!jobId) return { candidate, result: 'NO_JOB' };
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await soap('getReportJobStatus', `<ns:getReportJobStatus><ns:reportJobId>${jobId}</ns:reportJobId></ns:getReportJobStatus>`, tok);
    const status = tag(st.text, 'rval') ?? tag(st.text, 'status');
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      const u = await soap('getReportDownloadUrlWithOptions', `<ns:getReportDownloadUrlWithOptions><ns:reportJobId>${jobId}</ns:reportJobId><ns:reportDownloadOptions><ns:exportFormat>CSV_DUMP</ns:exportFormat><ns:useGzipCompression>true</ns:useGzipCompression></ns:reportDownloadOptions></ns:getReportDownloadUrlWithOptions>`, tok);
      const url = (tag(u.text,'rval') ?? tag(u.text,'url') ?? '').replace(/&amp;/g,'&');
      const dl = await fetch(url);
      const buf = Buffer.from(await dl.arrayBuffer());
      let csv: string; try { csv = zlib.gunzipSync(buf).toString('utf-8'); } catch { csv = buf.toString('utf-8'); }
      const lines = csv.split('\n').filter(Boolean);
      const headerCols = lines[0].split(',').length;
      const present = headerCols >= 3; // DATE + impressions + candidate
      // grab a sample value from the last column of a data row with impressions
      let sample = '';
      for (const ln of lines.slice(1)) { const parts = ln.split(','); if (parts.length >= 3 && Number(parts[1]) > 100) { sample = parts[parts.length-1]; break; } }
      return { candidate, result: present ? 'RETURNS DATA ✓' : 'DROPPED (no data)', sample };
    }
    if (status === 'FAILED') return { candidate, result: 'JOB_FAILED' };
  }
  return { candidate, result: 'TIMEOUT' };
}

async function main() {
  const tok = await token();
  const candidates = [
    'AD_EXCHANGE_MATCH_RATE',
    'AD_EXCHANGE_MATCHED_REQUESTS',
    'AD_EXCHANGE_TOTAL_REQUESTS',
    'AD_EXCHANGE_COVERAGE',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_MATCHED_REQUESTS',
    'AD_EXCHANGE_AD_REQUESTS',
    'AD_EXCHANGE_RESPONSES_SERVED',
  ];
  console.log('Testing match_rate / coverage candidates...\n');
  for (const c of candidates) {
    const r = await testCol(c, tok);
    console.log(`${r.result.padEnd(18)} ${r.candidate}${r.sample ? '  sample=' + r.sample : ''}${r.detail ? '  (' + r.detail + ')' : ''}`);
  }
}
main().catch(e => console.error('ERROR', e.message));