/**
 * Tests the CORRECT viewability column names (AD_EXCHANGE_ACTIVE_VIEW_*) found in
 * the v202511 Column enum, and downloads the report to confirm real values.
 *
 * The dashboard shows "Viewability 58.5%" so this data EXISTS — we just need the
 * right column. Active View viewable rate is the 58.5% metric.
 *
 * Run from apps/api:
 *   cp scripts/gam-activeview-probe.ts apps/api/
 *   cd apps/api
 *   node --env-file=../../.env --experimental-strip-types gam-activeview-probe.ts
 *   rm gam-activeview-probe.ts
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
  <soap:Header><ns:RequestHeader><ns:networkCode>${NETWORK}</ns:networkCode><ns:applicationName>avprobe</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL_, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8', SOAPAction:action, Authorization:`Bearer ${tok}`}, body: env });
  return { status: res.status, text: await res.text() };
}
function tag(xml: string, t: string) { return new RegExp(`<(?:[a-z]+:)?${t}>([^<]+)</(?:[a-z]+:)?${t}>`).exec(xml)?.[1]; }

async function downloadReport(label: string, cols: string[], tok: string) {
  console.log(`\n========== ${label} ==========`);
  const to = new Date();
  const from = new Date(Date.now() - 30*86400000);
  const colXml = cols.map(c => `<ns:columns>${c}</ns:columns>`).join('');
  const query = `<ns:dimensions>DATE</ns:dimensions>${colXml}${d('startDate',from)}${d('endDate',to)}<ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>`;
  const run = await soap('runReportJob', `<ns:runReportJob><ns:reportJob><ns:reportQuery>${query}</ns:reportQuery></ns:reportJob></ns:runReportJob>`, tok);
  if (run.status !== 200) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(run.text)?.[1];
    console.log('FAILED:', fault?.slice(0,200)); return;
  }
  const jobId = tag(run.text, 'id') ?? tag(run.text, 'rval');
  if (!jobId) { console.log('no jobId'); return; }
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
      console.log(`ROWS: ${lines.length} | header has ${headerCols} cols (requested ${cols.length}+1 DATE)`);
      console.log('HEADER:', lines[0]);
      console.log('rows 5-9:'); console.log(lines.slice(5, 10).join('\n'));
      console.log(headerCols >= cols.length + 1 ? '>>> ALL columns present ✓' : '>>> some DROPPED');
      return;
    }
    if (status === 'FAILED') { console.log('job FAILED'); return; }
  }
  console.log('timeout');
}

async function main() {
  const tok = await token();
  // Active View viewability columns (the 58.5% on the dashboard)
  await downloadReport('AV1: baseline + ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
    'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE',
  ], tok);

  await downloadReport('AV2: + viewable + measurable counts', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS',
    'AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS',
    'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE',
  ], tok);
}
main().catch(e => console.error('ERROR', e.message));