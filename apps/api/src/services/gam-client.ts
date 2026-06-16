/**
 * Google Ad Manager Reporting API client — SOAP, v202405.
 *
 * Why SOAP? Google's GAM API is SOAP-only for the report flow as of v202405.
 * Some Google client libs (`googleapis`) expose limited REST shims; the
 * canonical, reliable path for ReportService.runReportJob → getReportJobStatus
 * → getReportDownloadURL is SOAP. We construct the envelopes manually using
 * a small, controlled set of XML strings.
 *
 * Auth: service account JWT exchanged for an access token via
 * google-auth-library. Same JSON file the TL provided.
 *
 * Endpoints:
 *   https://ads.google.com/apis/ads/publisher/v202405/ReportService
 *
 * Header `applicationName` is required by GAM. Network code is the
 * publisher's GAM network code (env.GAM_NETWORK_CODE).
 */
import { GoogleAuth } from 'google-auth-library';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse } from 'csv-parse';
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

// Override via GAM_API_VERSION env if Google retires this one (~9 months).
const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const REPORT_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/ReportService`;
const SCOPE = 'https://www.googleapis.com/auth/dfp';
const APP_NAME = 'GAM Arbitrage Dashboard';

interface Logger {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

async function loadServiceAccount(): Promise<Record<string, unknown>> {
  if (process.env.GAM_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GAM_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
  }
  const p = env.GAM_SERVICE_ACCOUNT_JSON_PATH;
  if (!p) throw new Error('Neither GAM_SERVICE_ACCOUNT_JSON nor GAM_SERVICE_ACCOUNT_JSON_PATH is set');
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const buf = await fs.readFile(abs, 'utf-8');
  return JSON.parse(buf) as Record<string, unknown>;
}

let cachedAuth: GoogleAuth | null = null;
async function getAuth(): Promise<GoogleAuth> {
  if (cachedAuth) return cachedAuth;
  const credentials = await loadServiceAccount();
  cachedAuth = new GoogleAuth({ credentials: credentials as never, scopes: [SCOPE] });
  return cachedAuth;
}

async function getAccessToken(): Promise<string> {
  const auth = await getAuth();
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
  if (!token) throw new Error('Failed to obtain GAM access token');
  return token;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEnvelope(opts: {
  networkCode: string;
  accessToken: string;
  body: string;
}): string {
  // SOAP 1.1 envelope. RequestHeader carries app + network metadata.
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header>
    <ns:RequestHeader>
      <ns:networkCode>${xmlEscape(opts.networkCode)}</ns:networkCode>
      <ns:applicationName>${xmlEscape(APP_NAME)}</ns:applicationName>
    </ns:RequestHeader>
  </soap:Header>
  <soap:Body>
    ${opts.body}
  </soap:Body>
</soap:Envelope>`;
}

async function soapCall(opts: {
  action: string;
  body: string;
  log: Logger;
}): Promise<string> {
  const accessToken = await getAccessToken();
  const envelope = buildEnvelope({
    networkCode: env.GAM_NETWORK_CODE,
    accessToken,
    body: opts.body,
  });
  const res = await fetch(REPORT_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: opts.action,
      Authorization: `Bearer ${accessToken}`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) {
    opts.log.error(`GAM SOAP ${opts.action} failed: HTTP ${res.status}`, text.slice(0, 500));
    throw new Error(`GAM SOAP ${opts.action} HTTP ${res.status}: ${truncate(text, 200)}`);
  }
  if (text.includes('<faultstring>')) {
    const fault = /<faultstring[^>]*>([^<]+)<\/faultstring>/.exec(text)?.[1] ?? 'unknown fault';
    opts.log.error(`GAM SOAP ${opts.action} fault`, fault);
    throw new Error(`GAM SOAP fault: ${fault}`);
  }
  return text;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[a-z]+:)?${tag}>([^<]+)</(?:[a-z]+:)?${tag}>`).exec(xml);
  return m?.[1];
}

export interface GamReportRunOptions {
  fromDate: Date;
  toDate: Date;
  timezone?: string;
}

export interface ParsedReportRow {
  date: Date;
  adUnit: string;
  campaign: string;
  source: string;
  headline: string;
  lander: string;
  image: string;
  page: string;
  impressions: bigint;
  clicks: bigint;
  revenue: number;
  ecpm: number;
  viewability: number;
  matchRate: number;
}

/**
 * Submits a ReportJob to GAM, polls until COMPLETED, downloads the gzip CSV,
 * and returns parsed rows. Retries the whole flow up to 3 times.
 */
export async function runGamReport(opts: GamReportRunOptions, log: Logger): Promise<ParsedReportRow[]> {
  return retry(
    async () => {
      const { fromDate, toDate, timezone = env.GAM_REPORT_TIMEZONE } = opts;

      // 1. runReportJob ----------------------------------------------------
      // IMPORTANT: GAM XSD requires this exact element order:
      //   dimensions* → adUnitView? → columns* → startDate? → endDate? →
      //   dateRangeType → statement? → adxReportCurrency? → timeZoneType?
      const runBody = `<ns:runReportJob>
        <ns:reportJob>
          <ns:reportQuery>
            <ns:dimensions>DATE</ns:dimensions>
            <ns:dimensions>AD_UNIT_NAME</ns:dimensions>
            <ns:dimensions>CUSTOM_TARGETING_VALUE_ID</ns:dimensions>
            <ns:adUnitView>TOP_LEVEL</ns:adUnitView>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REQUESTS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_MATCH_RATE</ns:columns>
            <ns:startDate>
              <ns:year>${fromDate.getUTCFullYear()}</ns:year>
              <ns:month>${fromDate.getUTCMonth() + 1}</ns:month>
              <ns:day>${fromDate.getUTCDate()}</ns:day>
            </ns:startDate>
            <ns:endDate>
              <ns:year>${toDate.getUTCFullYear()}</ns:year>
              <ns:month>${toDate.getUTCMonth() + 1}</ns:month>
              <ns:day>${toDate.getUTCDate()}</ns:day>
            </ns:endDate>
            <ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>
            <ns:timeZoneType>AD_EXCHANGE</ns:timeZoneType>
          </ns:reportQuery>
        </ns:reportJob>
      </ns:runReportJob>`;
      log.info(`GAM: submitting ReportJob (${fromDate.toISOString().slice(0, 10)} → ${toDate.toISOString().slice(0, 10)}, tz=${timezone})`);
      const runXml = await soapCall({ action: 'runReportJob', body: runBody, log });
      const jobId = extractTag(runXml, 'id') ?? extractTag(runXml, 'rval');
      if (!jobId) throw new Error('Could not parse ReportJob id from GAM response');
      log.info(`GAM: job ${jobId} submitted; polling…`);

      // 2. poll getReportJobStatus -----------------------------------------
      const csv = await pollAndDownload(jobId, log);

      // 3. parse CSV --------------------------------------------------------
      const rows = await parseGamCsv(csv);
      log.info(`GAM: parsed ${rows.length} rows`);
      return rows;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2_000,
      maxDelayMs: 30_000,
      onRetry: (e, attempt, delay) => log.warn(`GAM run failed (attempt ${attempt}), retrying in ${delay}ms`, e),
    },
  );
}

async function pollAndDownload(jobId: string, log: Logger): Promise<string> {
  const start = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  let delay = 2_000;
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, delay));
    const statusBody = `<ns:getReportJobStatus><ns:reportJobId>${xmlEscape(jobId)}</ns:reportJobId></ns:getReportJobStatus>`;
    const statusXml = await soapCall({ action: 'getReportJobStatus', body: statusBody, log });
    const status = extractTag(statusXml, 'rval') ?? extractTag(statusXml, 'status');
    log.info(`GAM: job ${jobId} status=${status ?? '(unknown)'}`);
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      const urlBody = `<ns:getReportDownloadURL>
        <ns:reportJobId>${xmlEscape(jobId)}</ns:reportJobId>
        <ns:exportFormat>CSV_DUMP</ns:exportFormat>
      </ns:getReportDownloadURL>`;
      const urlXml = await soapCall({ action: 'getReportDownloadURL', body: urlBody, log });
      const url = extractTag(urlXml, 'rval') ?? extractTag(urlXml, 'url');
      if (!url) throw new Error('No download URL returned by GAM');
      log.info(`GAM: downloading report from ${url.slice(0, 80)}…`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GAM CSV download failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        return zlib.gunzipSync(buf).toString('utf-8');
      } catch {
        return buf.toString('utf-8');
      }
    }
    if (status === 'FAILED') throw new Error(`GAM ReportJob ${jobId} FAILED`);
    delay = Math.min(delay * 1.5, 20_000);
  }
  throw new Error(`GAM ReportJob ${jobId} timed out after ${TIMEOUT_MS / 1000}s`);
}

async function parseGamCsv(csv: string): Promise<ParsedReportRow[]> {
  return new Promise((resolve, reject) => {
    parse(
      csv,
      {
        columns: (header: string[]) =>
          header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')),
        skip_empty_lines: true,
        trim: true,
      },
      (err, rows: Record<string, string>[]) => {
        if (err) return reject(err);
        const out: ParsedReportRow[] = [];
        for (const r of rows) {
          const dateStr = r['dimension_date'] ?? r['date'] ?? '';
          if (!dateStr) continue;
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) continue;
          // GAM returns revenue and eCPM in micros (1/1,000,000 of currency unit)
          out.push({
            date,
            adUnit: r['dimension_ad_unit_name'] ?? r['ad_unit_name'] ?? r['ad_unit'] ?? '',
            campaign: r['dimension_campaign'] ?? r['campaign'] ?? '',
            source: r['dimension_source'] ?? r['source'] ?? '',
            headline: r['dimension_headline'] ?? r['headline'] ?? '',
            lander: r['dimension_lander'] ?? r['lander'] ?? '',
            image: r['dimension_image'] ?? r['image'] ?? '',
            page: r['dimension_page'] ?? r['page'] ?? '',
            impressions: BigInt(Math.floor(Number(r['column_ad_exchange_line_item_level_impressions'] ?? r['impressions'] ?? 0))),
            clicks: BigInt(Math.floor(Number(r['column_ad_exchange_line_item_level_clicks'] ?? r['clicks'] ?? 0))),
            revenue: Number(r['column_ad_exchange_line_item_level_revenue'] ?? r['revenue'] ?? 0) / 1_000_000,
            ecpm: Number(r['column_ad_exchange_line_item_level_average_ecpm'] ?? r['ecpm'] ?? 0) / 1_000_000,
            viewability: Number(r['column_ad_exchange_line_item_level_percent_viewable_impressions'] ?? r['viewability'] ?? 0) / 100,
            matchRate: Number(r['column_ad_exchange_line_item_level_match_rate'] ?? r['match_rate'] ?? 0) / 100,
          });
        }
        resolve(out);
      },
    );
  });
}
