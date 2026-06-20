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
  <soap:Header><ns:RequestHeader><ns:networkCode>${NETWORK}</ns:networkCode><ns:applicationName>metricsprobe</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL_, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8', SOAPAction:action, Authorization:`Bearer ${tok}`}, body: env });
  return { status: res.status, text: await res.text() };
}
function tag(xml: string, t: string) { return new RegExp(`<(?:[a-z]+:)?${t}>([^<]+)</(?:[a-z]+:)?${t}>`).exec(xml)?.[1]; }

async function runOne(label: string, cols: string[], tok: string) {
  console.log(`\n========== ${label} ==========`);
  const to = new Date();
  const from = new Date(Date.now() - 30*86400000);
  const colXml = cols.map(c => `<ns:columns>${c}</ns:columns>`).join('');
  const query = `<ns:dimensions>DATE</ns:dimensions>${colXml}${d('startDate',from)}${d('endDate',to)}<ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>`;
  const run = await soap('runReportJob', `<ns:runReportJob><ns:reportJob><ns:reportQuery>${query}</ns:reportQuery></ns:reportJob></ns:runReportJob>`, tok);
  if (run.status !== 200) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(run.text)?.[1];
    console.log('FAILED:', fault ?? run.text.slice(0, 300));
    return;
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
      console.log(`ROWS (incl header): ${lines.length}`);
      console.log('--- header + first 5 rows ---');
      console.log(lines.slice(0, 6).join('\n'));
      return;
    }
    if (status === 'FAILED') { console.log('job FAILED (columns likely unsupported for this network)'); return; }
  }
  console.log('timeout');
}

async function main() {
  const tok = await token();
  await runOne('A: baseline + VIEWABLE + MATCH_RATE + REQUESTS', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_MATCH_RATE',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REQUESTS',
  ], tok);
  await runOne('B: baseline + VIEWABLE only', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS',
  ], tok);
  await runOne('C: baseline + MATCH_RATE only', [
    'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
    'AD_EXCHANGE_LINE_ITEM_LEVEL_MATCH_RATE',
  ], tok);
}
main().catch(e => console.error('ERROR', e.message));