/**
 * Google Ad Manager Reporting API client — SOAP, OAuth user-flow, AD_EXCHANGE_* columns.
 *
 * Architecture (originally by Diksha, 2026-06-19):
 *   - Uses `googleapis` OAuth2 client (instead of a hand-rolled GoogleAuth wrapper)
 *   - SOAP envelope is constructed inline; CSV download is gzip-aware
 *
 * Metric set (ADR-016, 2026-06-20):
 *   - PRD §7.1 / §8.3 specified `AD_EXCHANGE_LINE_ITEM_LEVEL_*` columns.
 *     Verified in the GAM metric picker that those do NOT exist on River Five Global
 *     (no AdX line items configured). Using the regular `AD_EXCHANGE_*` family.
 *
 * Dimensions:
 *   - DATE + AD_UNIT_NAME + CUSTOM_TARGETING_VALUE_ID — needed for the dashboard's
 *     breakdown tables (campaign × source × headline × lander × image).
 *
 * Auth env vars (loaded from .env):
 *   - GAM_USER_OAUTH_CLIENT_ID
 *   - GAM_USER_OAUTH_CLIENT_SECRET
 *   Refresh token is loaded from secrets/gam-user-refresh-token.json (gitignored),
 *   produced by the `pnpm --filter @gam/api auth:gam` CLI.
 */
import { google } from 'googleapis';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const REPORT_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/ReportService`;
const APP_NAME = 'GAM Arbitrage Dashboard';
const REFRESH_TOKEN_PATH = path.resolve(process.cwd(), '../../secrets/gam-user-refresh-token.json');

interface Logger {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

/* ----------------------------- AUTH (OAuth2) ----------------------------- */
let cachedOAuth: InstanceType<typeof google.auth.OAuth2> | null = null;

async function loadRefreshToken(): Promise<string> {
  // Prefer the file produced by the auth:gam CLI; fall back to env var for prod.
  if (process.env.GAM_USER_OAUTH_REFRESH_TOKEN) return process.env.GAM_USER_OAUTH_REFRESH_TOKEN;
  try {
    const raw = await fs.readFile(REFRESH_TOKEN_PATH, 'utf-8');
    const json = JSON.parse(raw) as { refresh_token?: string };
    if (!json.refresh_token) throw new Error('refresh_token missing in token file');
    return json.refresh_token;
  } catch (e) {
    throw new Error(
      `GAM OAuth refresh token not available. Either set GAM_USER_OAUTH_REFRESH_TOKEN or run ` +
        `\`pnpm --filter @gam/api auth:gam\` to produce ${REFRESH_TOKEN_PATH}. Original: ${(e as Error).message}`,
    );
  }
}

async function getOAuthClient() {
  if (cachedOAuth) return cachedOAuth;
  const clientId = process.env.GAM_USER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GAM_USER_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GAM OAuth not configured. Set GAM_USER_OAUTH_CLIENT_ID and GAM_USER_OAUTH_CLIENT_SECRET in .env.');
  }
  const refreshToken = await loadRefreshToken();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  cachedOAuth = oauth2;
  return oauth2;
}

async function getAccessToken(): Promise<string> {
  const { token } = await (await getOAuthClient()).getAccessToken();
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
 * Parse GAM_CUSTOM_KEY_IDS env var into a name → numeric-id map.
 * Format: "campaign:19566476,source:19542339,headline:19542333,lander:19542345,image:19542366"
 *
 * Produced once by `pnpm --filter @gam/api gam:keys` (CLI in src/cli/gam-keys.ts).
 */
function parseCustomKeyIds(): { name: string; id: string }[] {
  const raw = process.env.GAM_CUSTOM_KEY_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, id] = pair.split(':');
      return { name: (name ?? '').trim(), id: (id ?? '').trim() };
    })
    .filter((k) => k.name && k.id);
}

export async function runGamReport(opts: GamReportRunOptions, log: Logger): Promise<ParsedReportRow[]> {
  return retry(
    async () => {
      const { fromDate, toDate, timezone = env.GAM_REPORT_TIMEZONE } = opts;
      const customKeys = parseCustomKeyIds();

      // No explicit dimension needed when customDimensionKeyIds is set; GAM
      // emits one column per key automatically.
      const customDimsXml = '';
      const customKeyIdsXml = customKeys
        .map((k) => `<ns:customDimensionKeyIds>${xmlEscape(k.id)}</ns:customDimensionKeyIds>`)
        .join('\n            ');

      // GAM v202511 ReportQuery XSD requires this exact element order:
      //   dimensions → adUnitView → columns → customDimensionKeyIds → startDate → endDate → ...
      const runBody = `<ns:runReportJob>
        <ns:reportJob>
          <ns:reportQuery>
            <ns:dimensions>DATE</ns:dimensions>
            <ns:dimensions>AD_UNIT_NAME</ns:dimensions>
            ${customDimsXml}
            <ns:adUnitView>TOP_LEVEL</ns:adUnitView>
            <ns:columns>AD_EXCHANGE_IMPRESSIONS</ns:columns>
            <ns:columns>AD_EXCHANGE_CLICKS</ns:columns>
            <ns:columns>AD_EXCHANGE_REVENUE</ns:columns>
            <ns:columns>AD_EXCHANGE_AVERAGE_ECPM</ns:columns>
            <ns:columns>AD_EXCHANGE_RESPONSES_SERVED</ns:columns>
            <ns:columns>AD_EXCHANGE_ACTIVE_VIEW_PERCENT_VIEWABLE_IMPRESSIONS</ns:columns>
            ${customKeyIdsXml}
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
            <ns:timeZoneType>PUBLISHER</ns:timeZoneType>
          </ns:reportQuery>
        </ns:reportJob>
      </ns:runReportJob>`;
      log.info(
        `GAM: submitting ReportJob (${fromDate.toISOString().slice(0, 10)} -> ${toDate.toISOString().slice(0, 10)}, tz=${timezone}, customKeys=${customKeys.length})`,
      );
      const runXml = await soapCall({ action: 'runReportJob', body: runBody, log });
      const jobId = extractTag(runXml, 'id') ?? extractTag(runXml, 'rval');
      if (!jobId) throw new Error('Could not parse ReportJob id from GAM response');
      log.info(`GAM: job ${jobId} submitted; polling...`);
      const csv = await pollAndDownload(jobId, log);
      const rows = await parseGamCsv(csv, customKeys);
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

async function parseGamCsv(csv: string, customKeys: { name: string; id: string }[] = []): Promise<ParsedReportRow[]> {
  return new Promise((resolve, reject) => {
    parse(
      csv,
      {
        columns: (header: string[]) =>
          header.map((h) => h.trim().toLowerCase().replace(/[.\s]+/g, '_').replace(/[^a-z0-9_]/g, '')),
        skip_empty_lines: true,
        trim: true,
      },
      (err, rows: Record<string, string>[]) => {
        if (err) return reject(err);
        const out: ParsedReportRow[] = [];
        // When customDimensionKeyIds is set, GAM emits per-key columns like
        // `Dimension.CUSTOM_TARGETING_VALUE_ID (Campaign)` → normalised to
        // `dimension_custom_targeting_value_id_campaign`.
        const customColumnByName = new Map<string, string>();
        for (const k of customKeys) {
          customColumnByName.set(k.name, `dimension_custom_targeting_value_id_${k.name.toLowerCase()}`);
        }
        const get = (r: Record<string, string>, ourName: string): string => {
          const candidate = customColumnByName.get(ourName);
          if (candidate && r[candidate]) return r[candidate]!;
          return r[`dimension_${ourName}`] ?? r[ourName] ?? '';
        };

        for (const r of rows) {
          const dateStr = r['dimension_date'] ?? r['date'] ?? '';
          if (!dateStr) continue;
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) continue;
          // Column-name mapping decided by ADR-016. We accept both new (AD_EXCHANGE_*)
          // and legacy (LINE_ITEM_LEVEL_*) header names so existing CSV uploads work.
          // Revenue and eCPM are micros (1/1,000,000 of report currency).
          out.push({
            date,
            adUnit: r['dimension_ad_unit_name'] ?? r['ad_unit_name'] ?? r['ad_unit'] ?? '',
            campaign: get(r, 'campaign'),
            source: get(r, 'source'),
            headline: get(r, 'headline'),
            lander: get(r, 'lander'),
            image: get(r, 'image'),
            page: r['dimension_page'] ?? r['page'] ?? '',
            impressions: BigInt(Math.floor(Number(
              r['column_ad_server_impressions'] ??
              r['column_ad_exchange_impressions'] ??
              r['column_ad_exchange_line_item_level_impressions'] ??
              r['impressions'] ?? 0,
            ))),
            clicks: BigInt(Math.floor(Number(
              r['column_ad_server_clicks'] ??
              r['column_ad_exchange_clicks'] ??
              r['column_ad_exchange_line_item_level_clicks'] ??
              r['clicks'] ?? 0,
            ))),
            revenue: Number(
              r['column_ad_server_cpm_and_cpc_revenue'] ??
              r['column_ad_exchange_revenue'] ??
              r['column_ad_exchange_line_item_level_revenue'] ??
              r['revenue'] ?? 0,
            ) / 1_000_000,
            ecpm: Number(
              r['column_ad_server_average_ecpm'] ??
              r['column_ad_exchange_average_ecpm'] ??
              r['column_ad_exchange_line_item_level_average_ecpm'] ??
              r['ecpm'] ?? 0,
            ) / 1_000_000,
            viewability: Number(
              r['column_ad_exchange_active_view_percent_viewable_impressions'] ??
              r['column_ad_exchange_active_view_viewable_impressions_rate'] ??
              r['column_ad_exchange_line_item_level_percent_viewable_impressions'] ??
              r['viewability'] ?? 0,
            ) / 100,
            matchRate: Number(
              r['column_ad_exchange_match_rate'] ??
              r['column_ad_exchange_line_item_level_match_rate'] ??
              r['match_rate'] ?? 0,
            ) / 100,
          });
        }
        resolve(out);
      },
    );
  });
}
