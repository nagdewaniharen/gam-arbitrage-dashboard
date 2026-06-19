/**
 * Google Ad Manager Reporting API client — SOAP, OAuth, Ad Exchange columns.
 *
 * This network (River Five Global) serves PROGRAMMATIC / Ad Exchange traffic,
 * so the report uses AD_EXCHANGE_LINE_ITEM_LEVEL_* columns (not the
 * TOTAL_LINE_ITEM_LEVEL_* ones, which return 0 rows for programmatic-only data).
 */
import { google } from 'googleapis';
import zlib from 'node:zlib';
import { parse } from 'csv-parse';
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const REPORT_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/ReportService`;
const APP_NAME = 'GAM Arbitrage Dashboard';

interface Logger {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

/* ----------------------------- AUTH (OAuth2) ----------------------------- */
let cachedOAuth: InstanceType<typeof google.auth.OAuth2> | null = null;
function getOAuthClient() {
  if (cachedOAuth) return cachedOAuth;
  const clientId = process.env.GAM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GAM_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GAM_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GAM OAuth not configured. Set GAM_OAUTH_CLIENT_ID, GAM_OAUTH_CLIENT_SECRET, GAM_OAUTH_REFRESH_TOKEN.');
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  cachedOAuth = oauth2;
  return oauth2;
}
async function getAccessToken(): Promise<string> {
  const { token } = await getOAuthClient().getAccessToken();
  if (!token) throw new Error('Failed to obtain GAM access token from refresh token');
  return token;
}

/* ------------------------------ SOAP plumbing ---------------------------- */
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function buildEnvelope(opts: { networkCode: string; body: string }): string {
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
async function soapCall(opts: { action: string; body: string; log: Logger }): Promise<string> {
  const accessToken = await getAccessToken();
  const envelope = buildEnvelope({ networkCode: env.GAM_NETWORK_CODE, body: opts.body });
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
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
    opts.log.error(`GAM SOAP ${opts.action} failed: HTTP ${res.status}`, fault ?? text);
    throw new Error(`GAM SOAP ${opts.action} HTTP ${res.status}: ${fault ?? text.slice(0, 800)}`);
  }
  const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
  if (fault) {
    opts.log.error(`GAM SOAP ${opts.action} fault`, fault);
    throw new Error(`GAM SOAP fault: ${fault}`);
  }
  return text;
}
function extractTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[a-z]+:)?${tag}>([^<]+)</(?:[a-z]+:)?${tag}>`).exec(xml);
  return m?.[1];
}

export interface GamReportRunOptions { fromDate: Date; toDate: Date; timezone?: string; }
export interface ParsedReportRow {
  date: Date; adUnit: string; campaign: string; source: string; headline: string;
  lander: string; image: string; page: string; impressions: bigint; clicks: bigint;
  revenue: number; ecpm: number; viewability: number; matchRate: number;
}

export async function runGamReport(opts: GamReportRunOptions, log: Logger): Promise<ParsedReportRow[]> {
  return retry(
    async () => {
      const { fromDate, toDate, timezone = env.GAM_REPORT_TIMEZONE } = opts;
      // Ad Exchange (programmatic) columns — match this network's data.
      const runBody = `<ns:runReportJob>
        <ns:reportJob>
          <ns:reportQuery>
            <ns:dimensions>DATE</ns:dimensions>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</ns:columns>
            <ns:columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</ns:columns>
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
          </ns:reportQuery>
        </ns:reportJob>
      </ns:runReportJob>`;
      log.info(`GAM: submitting ReportJob (${fromDate.toISOString().slice(0, 10)} -> ${toDate.toISOString().slice(0, 10)}, tz=${timezone})`);
      const runXml = await soapCall({ action: 'runReportJob', body: runBody, log });
      const jobId = extractTag(runXml, 'id') ?? extractTag(runXml, 'rval');
      if (!jobId) throw new Error('Could not parse ReportJob id from GAM response');
      log.info(`GAM: job ${jobId} submitted; polling...`);
      const csv = await pollAndDownload(jobId, log);
      const rows = await parseGamCsv(csv);
      log.info(`GAM: parsed ${rows.length} rows`);
      return rows;
    },
    {
      maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000,
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
      const urlBody = `<ns:getReportDownloadUrlWithOptions>
        <ns:reportJobId>${xmlEscape(jobId)}</ns:reportJobId>
        <ns:reportDownloadOptions>
          <ns:exportFormat>CSV_DUMP</ns:exportFormat>
          <ns:useGzipCompression>true</ns:useGzipCompression>
        </ns:reportDownloadOptions>
      </ns:getReportDownloadUrlWithOptions>`;
      const urlXml = await soapCall({ action: 'getReportDownloadUrlWithOptions', body: urlBody, log });
      const url = (extractTag(urlXml, 'rval') ?? extractTag(urlXml, 'url') ?? '').replace(/&amp;/g, '&');
      if (!url) throw new Error('No download URL returned by GAM');
      log.info(`GAM: downloading report from ${url.slice(0, 80)}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GAM CSV download failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      try { return zlib.gunzipSync(buf).toString('utf-8'); } catch { return buf.toString('utf-8'); }
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
          header.map((h) => h.trim().toLowerCase().replace(/[.\s]+/g, '_').replace(/[^a-z0-9_]/g, '')),
        skip_empty_lines: true, trim: true,
      },
      (err, rows: Record<string, string>[]) => {
        if (err) return reject(err);
        const out: ParsedReportRow[] = [];
        for (const r of rows) {
          const dateStr = r['dimension_date'] ?? r['date'] ?? '';
          if (!dateStr) continue;
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) continue;
          // Ad Exchange revenue/eCPM are in micros (1/1,000,000 currency unit).
          out.push({
            date,
            adUnit: r['dimension_ad_unit_name'] ?? r['ad_unit_name'] ?? r['ad_unit'] ?? '',
            campaign: '', source: '', headline: '', lander: '', image: '', page: '',
            impressions: BigInt(Math.floor(Number(
              r['column_ad_exchange_line_item_level_impressions'] ?? r['impressions'] ?? 0))),
            clicks: BigInt(Math.floor(Number(
              r['column_ad_exchange_line_item_level_clicks'] ?? r['clicks'] ?? 0))),
            revenue: Number(
              r['column_ad_exchange_line_item_level_revenue'] ?? r['revenue'] ?? 0) / 1_000_000,
            ecpm: Number(
              r['column_ad_exchange_line_item_level_average_ecpm'] ?? r['ecpm'] ?? 0) / 1_000_000,
            viewability: 0,
            matchRate: 0,
          });
        }
        resolve(out);
      },
    );
  });
}