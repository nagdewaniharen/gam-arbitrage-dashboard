/**
 * GAM report probe — tries several column sets and prints the RAW CSV for each,
 * so we can see exactly which columns return data for this network.
 *
 * Run from scripts/ (or apps/api):
 *   node --env-file=../.env --experimental-strip-types gam-probe.ts
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
  <soap:Header><ns:RequestHeader><ns:networkCode>${NETWORK}</ns:networkCode><ns:applicationName>probe</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL_, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8', SOAPAction:action, Authorization:`Bearer ${tok}`}, body: env });
  return { status: res.status, text: await res.text() };
}
function tag(xml: string, t: string) { return new RegExp(`<(?:[a-z]+:)?${t}>([^<]+)</(?:[a-z]+:)?${t}>`).exec(xml)?.[1]; }

async function runOne(label: string, query: string, tok: string) {
  console.log(`\n========== ${label} ==========`);
  const run = await soap('runReportJob', `<ns:runReportJob><ns:reportJob><ns:reportQuery>${query}</ns:reportQuery></ns:reportJob></ns:runReportJob>`, tok);
  if (run.status !== 200) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(run.text)?.[1];
    console.log('runReportJob FAILED:', fault ?? run.text.slice(0, 400));
    return;
  }
  const jobId = tag(run.text, 'id') ?? tag(run.text, 'rval');
  if (!jobId) { console.log('no jobId'); return; }
  // poll
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await soap('getReportJobStatus', `<ns:getReportJobStatus><ns:reportJobId>${jobId}</ns:reportJobId></ns:getReportJobStatus>`, tok);
    const status = tag(st.text, 'rval') ?? tag(st.text, 'status');
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      const u = await soap('getReportDownloadUrlWithOptions', `<ns:getReportDownloadUrlWithOptions><ns:reportJobId>${jobId}</ns:reportJobId><ns:reportDownloadOptions><ns:exportFormat>CSV_DUMP</ns:exportFormat><ns:useGzipCompression>true</ns:useGzipCompression></ns:reportDownloadOptions></ns:getReportDownloadUrlWithOptions>`, tok);
      const url = (tag(u.text,'rval') ?? tag(u.text,'url') ?? '').replace(/&amp;/g,'&');
      if (!url) { console.log('no url'); return; }
      const dl = await fetch(url);
      const buf = Buffer.from(await dl.arrayBuffer());
      let csv: string; try { csv = zlib.gunzipSync(buf).toString('utf-8'); } catch { csv = buf.toString('utf-8'); }
      const lines = csv.split('\n').filter(Boolean);
      console.log(`ROWS (incl header): ${lines.length}`);
      console.log('--- first 8 lines ---');
      console.log(lines.slice(0, 8).join('\n'));
      return;
    }
    if (status === 'FAILED') { console.log('job FAILED'); return; }
  }
  console.log('timeout');
}

async function main() {
  const tok = await token();
  const to = new Date();
  const from = new Date(Date.now() - 30*86400000);
  const dates = `${d('startDate', from)}${d('endDate', to)}<ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>`;

  // A: Total Ad Exchange, DATE only (network-level programmatic)
  await runOne('A: TOTAL_AD_EXCHANGE by DATE',
    `<ns:dimensions>DATE</ns:dimensions>
     <ns:columns>TOTAL_AD_EXCHANGE_IMPRESSIONS</ns:columns>
     <ns:columns>TOTAL_AD_EXCHANGE_REVENUE</ns:columns>${dates}`, tok);

  // B: Total line item level, DATE only
  await runOne('B: TOTAL_LINE_ITEM_LEVEL by DATE',
    `<ns:dimensions>DATE</ns:dimensions>
     <ns:columns>TOTAL_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
     <ns:columns>TOTAL_LINE_ITEM_LEVEL_CPM_AND_CPC_REVENUE</ns:columns>${dates}`, tok);

  // C: Ad Exchange line item level, DATE only
  await runOne('C: AD_EXCHANGE_LINE_ITEM_LEVEL by DATE',
    `<ns:dimensions>DATE</ns:dimensions>
     <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
     <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</ns:columns>${dates}`, tok);

  // D: Total impressions (most generic column that exists everywhere)
  await runOne('D: TOTAL_IMPRESSIONS / TOTAL_CLICKS by DATE',
    `<ns:dimensions>DATE</ns:dimensions>
     <ns:columns>TOTAL_IMPRESSIONS</ns:columns>
     <ns:columns>TOTAL_CLICKS</ns:columns>${dates}`, tok);
}
main().catch(e => console.error('ERROR', e.message));
