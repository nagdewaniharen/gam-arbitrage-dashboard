/**
 * Diagnostic: queries GAM with LINE_ITEM_TYPE dimension to see what types
 * exist on this network, then sums revenue per type. Used to determine
 * which line item types map to GAM UI's "Programmatic channels".
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/diagnose-line-item-types.ts [YYYY-MM-DD] [YYYY-MM-DD]
 *   Default: last 30 days
 */
import { google } from 'googleapis';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const REPORT_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/ReportService`;
const REFRESH_TOKEN_PATH = path.resolve(process.cwd(), '../../secrets/gam-user-refresh-token.json');

async function loadRefreshToken(): Promise<string> {
  if (process.env.GAM_USER_OAUTH_REFRESH_TOKEN) return process.env.GAM_USER_OAUTH_REFRESH_TOKEN;
  const raw = await fs.readFile(REFRESH_TOKEN_PATH, 'utf-8');
  return (JSON.parse(raw) as { refresh_token: string }).refresh_token;
}

async function getAccessToken(): Promise<string> {
  const oauth2 = new google.auth.OAuth2(
    process.env.GAM_USER_OAUTH_CLIENT_ID!,
    process.env.GAM_USER_OAUTH_CLIENT_SECRET!,
  );
  oauth2.setCredentials({ refresh_token: await loadRefreshToken() });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('No access token');
  return token;
}

async function soap(body: string, token: string, networkCode: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header>
    <ns:RequestHeader>
      <ns:networkCode>${networkCode}</ns:networkCode>
      <ns:applicationName>GAM Arbitrage Dashboard — diag</ns:applicationName>
    </ns:RequestHeader>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(REPORT_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
      Authorization: `Bearer ${token}`,
    },
    body: envelope,
  });
  const xml = await res.text();
  if (!res.ok || xml.includes('<faultstring>')) {
    const m = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    throw new Error(`SOAP fault: ${m?.[1] ?? xml.slice(0, 400)}`);
  }
  return xml;
}

function extract(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]!.trim() : null;
}

async function main() {
  const fromArg = process.argv[2];
  const toArg = process.argv[3];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = fromArg ? new Date(fromArg + 'T00:00:00Z') : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const to = toArg ? new Date(toArg + 'T00:00:00Z') : today;
  console.log(`Diagnostic for ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);

  const token = await getAccessToken();

  const body = `<ns:runReportJob>
    <ns:reportJob>
      <ns:reportQuery>
        <ns:dimensions>LINE_ITEM_TYPE</ns:dimensions>
        <ns:columns>TOTAL_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
        <ns:columns>TOTAL_LINE_ITEM_LEVEL_CPM_AND_CPC_REVENUE</ns:columns>
        <ns:startDate>
          <ns:year>${from.getUTCFullYear()}</ns:year>
          <ns:month>${from.getUTCMonth() + 1}</ns:month>
          <ns:day>${from.getUTCDate()}</ns:day>
        </ns:startDate>
        <ns:endDate>
          <ns:year>${to.getUTCFullYear()}</ns:year>
          <ns:month>${to.getUTCMonth() + 1}</ns:month>
          <ns:day>${to.getUTCDate()}</ns:day>
        </ns:endDate>
        <ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>
        <ns:timeZoneType>PUBLISHER</ns:timeZoneType>
      </ns:reportQuery>
    </ns:reportJob>
  </ns:runReportJob>`;

  const runXml = await soap(body, token, process.env.GAM_NETWORK_CODE!);
  const jobId = extract(runXml, 'id');
  if (!jobId) throw new Error('no job id');
  console.log(`Job ${jobId} submitted, polling...`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const sx = await soap(
      `<ns:getReportJobStatus><ns:reportJobId>${jobId}</ns:reportJobId></ns:getReportJobStatus>`,
      token,
      process.env.GAM_NETWORK_CODE!,
    );
    const st = extract(sx, 'rval') ?? '';
    if (st === 'COMPLETED') break;
    if (st === 'FAILED') throw new Error('Job FAILED');
    if (i === 29) throw new Error('Job timeout');
  }
  const urlXml = await soap(
    `<ns:getReportDownloadURL><ns:reportJobId>${jobId}</ns:reportJobId><ns:exportFormat>CSV_DUMP</ns:exportFormat></ns:getReportDownloadURL>`,
    token,
    process.env.GAM_NETWORK_CODE!,
  );
  const url = (extract(urlXml, 'rval') ?? '').replace(/&amp;/g, '&');
  if (!url) throw new Error('no url');
  const csvRes = await fetch(url);
  const buf = Buffer.from(await csvRes.arrayBuffer());
  const csv = buf[0] === 0x1f ? zlib.gunzipSync(buf).toString('utf-8') : buf.toString('utf-8');

  console.log('\nRAW CSV (first 1500 chars):\n' + csv.slice(0, 1500) + '\n---\n');

  const rows: Record<string, string>[] = await new Promise((resolve, reject) =>
    parse(csv, { columns: true, skip_empty_lines: true, trim: true }, (err, rows) =>
      err ? reject(err) : resolve(rows),
    ),
  );

  console.log(`\nCSV header: ${Object.keys(rows[0] ?? {}).join(', ')}\n`);
  console.log(`Breakdown by LINE_ITEM_TYPE (${rows.length} types):`);
  console.log('='.repeat(80));
  let totalRev = 0;
  let totalImp = 0;
  const sorted = rows.slice().sort((a, b) => {
    const ar = Number(Object.values(a).find((_, i) => Object.keys(a)[i]?.includes('revenue')) ?? 0);
    const br = Number(Object.values(b).find((_, i) => Object.keys(b)[i]?.includes('revenue')) ?? 0);
    return br - ar;
  });
  for (const r of sorted) {
    const type = Object.entries(r).find(([k]) => k.toLowerCase().includes('line_item_type') || k.toLowerCase().includes('dimension'))?.[1] ?? '?';
    const imp = Number(Object.entries(r).find(([k]) => k.toLowerCase().includes('impressions'))?.[1] ?? 0);
    const rev = Number(Object.entries(r).find(([k]) => k.toLowerCase().includes('revenue'))?.[1] ?? 0) / 1_000_000;
    totalImp += imp;
    totalRev += rev;
    console.log(`  ${String(type).padEnd(30)}  imp=${String(imp).padStart(8)}  rev=$${rev.toFixed(2)}`);
  }
  console.log('='.repeat(80));
  console.log(`  TOTAL                            imp=${String(totalImp).padStart(8)}  rev=$${totalRev.toFixed(2)}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
