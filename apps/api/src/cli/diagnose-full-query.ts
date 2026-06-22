/**
 * Diagnostic: runs the EXACT production query (DATE + AD_UNIT_NAME +
 * LINE_ITEM_TYPE dimensions, TOTAL_LINE_ITEM_LEVEL_* columns) and dumps the
 * raw CSV plus aggregates. Used to confirm whether GAM emits rows with an
 * empty LINE_ITEM_TYPE and how the totals split.
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/diagnose-full-query.ts [FROM] [TO]
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

async function token(): Promise<string> {
  const raw = await fs.readFile(REFRESH_TOKEN_PATH, 'utf-8');
  const oauth2 = new google.auth.OAuth2(
    process.env.GAM_USER_OAUTH_CLIENT_ID!,
    process.env.GAM_USER_OAUTH_CLIENT_SECRET!,
  );
  oauth2.setCredentials({ refresh_token: (JSON.parse(raw) as { refresh_token: string }).refresh_token });
  return (await oauth2.getAccessToken()).token!;
}

async function soap(body: string, t: string): Promise<string> {
  const env = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header><ns:RequestHeader><ns:networkCode>${process.env.GAM_NETWORK_CODE}</ns:networkCode><ns:applicationName>diag</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  const r = await fetch(REPORT_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Authorization: `Bearer ${t}` },
    body: env,
  });
  const xml = await r.text();
  if (!r.ok || xml.includes('<faultstring>')) {
    const m = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    throw new Error(m?.[1] ?? xml.slice(0, 400));
  }
  return xml;
}

const xtag = (x: string, t: string) => x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]?.trim();

async function main() {
  const from = new Date((process.argv[2] ?? '2026-05-24') + 'T00:00:00Z');
  const to = new Date((process.argv[3] ?? '2026-06-22') + 'T00:00:00Z');
  console.log(`Production-shape query: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
  const t = await token();
  const body = `<ns:runReportJob><ns:reportJob><ns:reportQuery>
    <ns:dimensions>DATE</ns:dimensions>
    <ns:dimensions>AD_UNIT_NAME</ns:dimensions>
    <ns:dimensions>LINE_ITEM_TYPE</ns:dimensions>
    <ns:adUnitView>TOP_LEVEL</ns:adUnitView>
    <ns:columns>TOTAL_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
    <ns:columns>TOTAL_LINE_ITEM_LEVEL_CPM_AND_CPC_REVENUE</ns:columns>
    <ns:startDate><ns:year>${from.getUTCFullYear()}</ns:year><ns:month>${from.getUTCMonth() + 1}</ns:month><ns:day>${from.getUTCDate()}</ns:day></ns:startDate>
    <ns:endDate><ns:year>${to.getUTCFullYear()}</ns:year><ns:month>${to.getUTCMonth() + 1}</ns:month><ns:day>${to.getUTCDate()}</ns:day></ns:endDate>
    <ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>
    <ns:timeZoneType>PUBLISHER</ns:timeZoneType>
  </ns:reportQuery></ns:reportJob></ns:runReportJob>`;
  const j = xtag(await soap(body, t), 'id')!;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = xtag(
      await soap(`<ns:getReportJobStatus><ns:reportJobId>${j}</ns:reportJobId></ns:getReportJobStatus>`, t),
      'rval',
    );
    if (s === 'COMPLETED') break;
    if (s === 'FAILED') throw new Error('FAILED');
  }
  const url = xtag(
    await soap(`<ns:getReportDownloadURL><ns:reportJobId>${j}</ns:reportJobId><ns:exportFormat>CSV_DUMP</ns:exportFormat></ns:getReportDownloadURL>`, t),
    'rval',
  )!.replace(/&amp;/g, '&');
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const csv = buf[0] === 0x1f ? zlib.gunzipSync(buf).toString('utf-8') : buf.toString('utf-8');

  const rows: Record<string, string>[] = await new Promise((res, rej) =>
    parse(csv, { columns: true, skip_empty_lines: true, trim: true }, (e, r) => (e ? rej(e) : res(r))),
  );

  console.log(`\nCSV headers: ${Object.keys(rows[0] ?? {}).join(' | ')}\n`);
  console.log(`${rows.length} rows total`);

  // Distinct LINE_ITEM_TYPE values
  const typeKey = Object.keys(rows[0] ?? {}).find((k) => k.toLowerCase().includes('line_item_type')) ?? '';
  console.log(`\nLINE_ITEM_TYPE column key: "${typeKey}"`);
  const byType = new Map<string, { imp: number; rev: number; count: number }>();
  for (const r of rows) {
    const tv = (r[typeKey] ?? '').trim();
    const label = tv === '' ? '(empty)' : tv;
    const cur = byType.get(label) ?? { imp: 0, rev: 0, count: 0 };
    const impKey = Object.keys(r).find((k) => k.toLowerCase().includes('impressions'))!;
    const revKey = Object.keys(r).find((k) => k.toLowerCase().includes('revenue'))!;
    cur.imp += Number(r[impKey] ?? 0);
    cur.rev += Number(r[revKey] ?? 0) / 1_000_000;
    cur.count += 1;
    byType.set(label, cur);
  }
  console.log('\nBreakdown by LINE_ITEM_TYPE value:');
  let totImp = 0;
  let totRev = 0;
  for (const [type, v] of [...byType.entries()].sort((a, b) => b[1].rev - a[1].rev)) {
    console.log(`  ${type.padEnd(20)} rows=${String(v.count).padStart(4)}  imp=${String(v.imp).padStart(8)}  rev=$${v.rev.toFixed(2)}`);
    totImp += v.imp;
    totRev += v.rev;
  }
  console.log(`  ${'TOTAL'.padEnd(20)}            imp=${String(totImp).padStart(8)}  rev=$${totRev.toFixed(2)}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
