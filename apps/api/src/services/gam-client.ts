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
 *   - DOMAIN (site filter): GAM rejects DOMAIN when paired with
 *     TOTAL_LINE_ITEM_LEVEL_* columns (COLUMNS_NOT_SUPPORTED_FOR_REQUESTED_DIMENSIONS).
 *     DOMAIN is only compatible with AD_EXCHANGE_* columns. We omit DOMAIN from
 *     the TOTAL and TOTAL+viewability queries; the `site` column stays empty for
 *     GAM-pulled rows. To populate it, either upload a CSV with a `site` column
 *     or extend this client with a separate ad_exchange+DOMAIN query (TODO).
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
  info: (_m: string, _e?: unknown) => void;
  warn: (_m: string, _e?: unknown) => void;
  error: (_m: string, _e?: unknown) => void;
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

// Expose the last raw SOAP fault XML we saw so operators can copy-paste it
// verbatim into support tickets.
export let lastSoapFaultXml: string | null = null;
export let lastSoapRequestXml: string | null = null;

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
    lastSoapFaultXml = text;
    lastSoapRequestXml = envelope;
    opts.log.error(`GAM SOAP ${opts.action} failed: HTTP ${res.status}`, fault ?? text);
    throw new Error(`GAM SOAP ${opts.action} HTTP ${res.status}: ${fault ?? text.slice(0, 800)}`);
  }
  const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
  if (fault) {
    lastSoapFaultXml = text;
    lastSoapRequestXml = envelope;
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
  /**
   * Which GAM column family to request.
   *   - 'ad_exchange' (default): AD_EXCHANGE_* — Open Auction only.
   *   - 'total_line_item_level': TOTAL_LINE_ITEM_LEVEL_* — sum of ALL programmatic
   *     channels (Open Auction + Preferred Deals + Programmatic Guaranteed + direct).
   *     Matches the GAM UI "Programmatic channels" total.
   *   - 'viewability_metrics': active-view + match-rate columns, run separately
   *     because they can't appear alongside LINE_ITEM_TYPE dim.
   *   - 'site_breakdown': minimal AD_EXCHANGE_IMPRESSIONS + DOMAIN dim, used only
   *     to compute per-(date, ad_unit) dominant site for tagging main rows.
   *     GAM rejects DOMAIN alongside TOTAL_LINE_ITEM_LEVEL_*, so we pull site
   *     attribution separately here.
   */
  columnFamily?: 'ad_exchange' | 'total_line_item_level' | 'viewability_metrics' | 'site_breakdown';
}

// Debug: expose raw CSV header + first row from the last runGamReport call
// so callers can identify GAM's actual column names.
export let lastCsvHeaderDebug: { header: string; row1: string } | null = null;

export interface ParsedReportRow {
  date: Date;
  adUnit: string;
  campaign: string;
  source: string;
  headline: string;
  lander: string;
  image: string;
  site: string;
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
      // Default is TOTAL_LINE_ITEM_LEVEL_* to match the GAM UI "Programmatic
      // channels" total (Open Auction + Preferred Deals + PG + direct sold).
      // The 'ad_exchange' family stays available for arbitrage-focused analysis.
      const columnFamily = opts.columnFamily ?? 'total_line_item_level';
      const customKeys = parseCustomKeyIds();
      const columnsXmlBlock = (
        columnFamily === 'total_line_item_level'
          ? [
            // Line-item-attributed metrics only — these are valid when the
            // LINE_ITEM_TYPE dimension is requested. TOTAL_AD_REQUESTS and
            // network-level active-view columns are NOT valid at line-item
            // granularity (GAM throws COLUMNS_NOT_SUPPORTED_FOR_REQUESTED_DIMENSIONS).
            'TOTAL_LINE_ITEM_LEVEL_IMPRESSIONS',
            'TOTAL_LINE_ITEM_LEVEL_CLICKS',
            'TOTAL_LINE_ITEM_LEVEL_CPM_AND_CPC_REVENUE',
            'TOTAL_LINE_ITEM_LEVEL_AVERAGE_ECPM',
          ]
          : columnFamily === 'viewability_metrics'
            ? [
              // Network-aggregate viewability + match-rate. These columns
              // can't appear alongside LINE_ITEM_TYPE dim — run separately
              // and merge by (date, ad_unit) in the runner.
              // Column names verified by scripts/gam-activeview-probe.ts:
              // TOTAL_ACTIVE_VIEW_* doesn't exist on this network; the
              // working column is AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE.
              'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE',
              'AD_EXCHANGE_MATCH_RATE',
              'TOTAL_AD_REQUESTS',
            ]
            : columnFamily === 'site_breakdown'
              ? [
                // DOMAIN is incompatible with TOTAL_AD_REQUESTS and with the
                // AD_EXCHANGE_IMPRESSIONS/REVENUE family (network config).
                // Try the ACTIVE_VIEW count columns (same family as the rate
                // column that we've confirmed works with DOMAIN).
                'AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS',
                'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE',
              ]
              : [
                'AD_EXCHANGE_IMPRESSIONS',
                'AD_EXCHANGE_CLICKS',
                'AD_EXCHANGE_REVENUE',
                'AD_EXCHANGE_AVERAGE_ECPM',
                'AD_EXCHANGE_RESPONSES_SERVED',
                'AD_EXCHANGE_ACTIVE_VIEW_PERCENT_VIEWABLE_IMPRESSIONS',
              ]
      )
        .map((c) => `<ns:columns>${c}</ns:columns>`)
        .join('\n            ');

      // Custom-targeting reporting is blocked at the GAM API level on this
      // network (ADR-018). Every combination tried returns
      // INVALID_CUSTOM_CRITERIA_DIMENSION. Keep customDimensionKeyIds support
      // wired but emit nothing until the GAM admin enables custom-targeting
      // reporting access — at that point uncommenting the line below should
      // make the breakdowns light up.
      // const customDimsXml = customKeys.length
      //   ? '<ns:dimensions>CUSTOM_TARGETING_VALUE_ID</ns:dimensions>'
      //   : '';
      const customDimsXml = '';
      const customKeyIdsXml = customKeys
        .map((k) => `<ns:customDimensionKeyIds>${xmlEscape(k.id)}</ns:customDimensionKeyIds>`)
        .join('\n            ');

      // Adding LINE_ITEM_TYPE as a dimension filters rows to only those with a
      // line-item attribution. This matches GAM UI's "Programmatic channels"
      // total exactly (excludes dynamic-allocation impressions that didn't
      // route through a line item). Only emitted with the TOTAL family.
      const lineItemTypeDimXml =
        columnFamily === 'total_line_item_level' ? '<ns:dimensions>LINE_ITEM_TYPE</ns:dimensions>' : '';

      // For site_breakdown, mirror what the GAM UI Interactive Report uses:
      // AD_EXCHANGE_SITE_NAME as the only non-DATE dim, minimal columns, no
      // AD_UNIT_NAME dim (it seems incompatible), no adUnitView (TOP_LEVEL
      // only applies when an AD_UNIT_* dim is present).
      const isSiteBreakdown = columnFamily === 'site_breakdown';
      const adUnitDimXml = isSiteBreakdown ? '' : '<ns:dimensions>AD_UNIT_NAME</ns:dimensions>';
      // Trying SITE_ID as one more attempt for subdomain granularity. If GAM
      // returns numeric IDs that map to configured Site entities (Inventory→
      // Sites), we can preserve subdomain distinction — falls back to DOMAIN
      // (7 base domains) via graceful degradation if silently stripped.
      const siteDimXml = isSiteBreakdown
        ? '<ns:dimensions>SITE_ID</ns:dimensions>\n            <ns:dimensions>DOMAIN</ns:dimensions>'
        : '';
      const adUnitViewXml = isSiteBreakdown ? '' : '<ns:adUnitView>TOP_LEVEL</ns:adUnitView>';

      // GAM v202511 ReportQuery XSD requires this exact element order:
      //   dimensions → adUnitView → columns → customDimensionKeyIds → startDate → endDate → ...
      const runBody = `<ns:runReportJob>
        <ns:reportJob>
          <ns:reportQuery>
            <ns:dimensions>DATE</ns:dimensions>
            ${adUnitDimXml}
            ${siteDimXml}
            ${lineItemTypeDimXml}
            ${customDimsXml}
            ${adUnitViewXml}
            ${columnsXmlBlock}
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
      let csv: string;
      try {
        csv = zlib.gunzipSync(buf).toString('utf-8');
      } catch {
        csv = buf.toString('utf-8');
      }
      // Log the CSV header + first data row so we can see what columns GAM
      // actually emits (helps identify the right site/url column name).
      const firstNewline = csv.indexOf('\n');
      const secondNewline = csv.indexOf('\n', firstNewline + 1);
      if (firstNewline > 0) {
        const header = csv.slice(0, firstNewline).slice(0, 500);
        const row1 = secondNewline > 0 ? csv.slice(firstNewline + 1, secondNewline).slice(0, 500) : '';
        log.info(`GAM CSV header: ${header}`);
        if (row1) log.info(`GAM CSV row 1: ${row1}`);
        lastCsvHeaderDebug = { header, row1 };
      }
      return csv;
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
          // When the LINE_ITEM_TYPE dimension is included, GAM emits rows
          // for both line-item-attributed and unattributed traffic. Drop the
          // unattributed rows — that's what GAM UI's "Programmatic channels"
          // total filters out, and matching that view is the goal.
          //
          // BUT only apply this filter when LINE_ITEM_TYPE is actually a
          // dimension of the report — other queries (e.g., viewability
          // metrics) intentionally omit it, and we shouldn't drop their rows.
          const hasLineItemTypeColumn = Object.keys(r).some((k) => k.toLowerCase().includes('line_item_type'));
          if (hasLineItemTypeColumn) {
            const lineItemType = r['dimension_line_item_type'] ?? r['line_item_type'] ?? '';
            if (lineItemType === '' || lineItemType.toUpperCase() === 'UNKNOWN' || lineItemType.toUpperCase() === 'NULL') continue;
          }
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
            site: (() => {
              const raw =
                // Prefer site_name if GAM populates it (via SITE_ID lookup),
                // then hostname/URL variants for subdomain preservation, and
                // finally DOMAIN for base-domain fallback.
                r['dimension_site_name'] ??
                r['dimension_hostname'] ??
                r['dimension_ad_exchange_hostname'] ??
                r['dimension_ad_exchange_url'] ??
                r['dimension_url'] ??
                r['dimension_ad_exchange_site_name'] ??
                r['dimension_site_id'] ??
                r['dimension_domain'] ??
                r['ad_exchange_url'] ??
                r['url'] ??
                r['site'] ??
                r['domain'] ??
                r['hostname'] ??
                '';
              if (!raw) return '';
              // GAM returns full URLs; parse the hostname for filter-friendliness.
              try {
                return new URL(raw.startsWith('http') ? raw : `http://${raw}`).hostname;
              } catch {
                return raw;
              }
            })(),
            page: r['dimension_page'] ?? r['page'] ?? '',
            impressions: BigInt(Math.floor(Number(
              r['column_total_line_item_level_impressions'] ??
              r['column_ad_server_impressions'] ??
              r['column_ad_exchange_impressions'] ??
              r['column_ad_exchange_line_item_level_impressions'] ??
              // For site_breakdown rows on networks that strip AD_EXCHANGE_*,
              // ACTIVE_VIEW measurable impressions is the count proxy that
              // survives with DOMAIN dim.
              r['column_ad_exchange_active_view_measurable_impressions'] ??
              r['column_total_ad_requests'] ??
              r['impressions'] ?? 0,
            ))),
            clicks: BigInt(Math.floor(Number(
              r['column_total_line_item_level_clicks'] ??
              r['column_ad_server_clicks'] ??
              r['column_ad_exchange_clicks'] ??
              r['column_ad_exchange_line_item_level_clicks'] ??
              r['clicks'] ?? 0,
            ))),
            revenue: Number(
              r['column_total_line_item_level_cpm_and_cpc_revenue'] ??
              r['column_ad_server_cpm_and_cpc_revenue'] ??
              r['column_ad_exchange_revenue'] ??
              r['column_ad_exchange_line_item_level_revenue'] ??
              r['revenue'] ?? 0,
            ) / 1_000_000,
            //new row gets a real eCPM
            ecpm: (() => {
              const impr = Math.floor(Number(
                r['column_total_line_item_level_impressions'] ??
                r['column_ad_server_impressions'] ??
                r['column_ad_exchange_impressions'] ??
                r['column_ad_exchange_line_item_level_impressions'] ??
                r['impressions'] ?? 0,
              ));
              const rev = Number(
                r['column_total_line_item_level_cpm_and_cpc_revenue'] ??
                r['column_ad_server_cpm_and_cpc_revenue'] ??
                r['column_ad_exchange_revenue'] ??
                r['column_ad_exchange_line_item_level_revenue'] ??
                r['revenue'] ?? 0,
              ) / 1_000_000;
              return impr > 0 ? (rev / impr) * 1000 : 0;
            })(),
            // Auto-detect scale: GAM v202511 returns rates as 0-1 fractions
            // for TOTAL_* / ADX_* columns but the legacy LINE_ITEM_LEVEL_*
            // columns + CSV uploads use 0-100. Anything > 1 → assume the
            // legacy percentage form and normalize back into 0-1 land.
            viewability: (() => {
              const v = Number(
                r['column_total_active_view_percent_viewable_impressions'] ??
                r['column_ad_exchange_active_view_percent_viewable_impressions'] ??
                r['column_ad_exchange_active_view_viewable_impressions_rate'] ??
                r['column_ad_exchange_line_item_level_percent_viewable_impressions'] ??
                r['viewability'] ?? 0,
              );
              return v > 1 ? v / 100 : v;
            })(),
            matchRate: (() => {
              const v = Number(
                r['column_ad_exchange_match_rate'] ??
                r['column_ad_exchange_line_item_level_match_rate'] ??
                r['match_rate'] ?? 0,
              );
              return v > 1 ? v / 100 : v;
            })(),
          });
        }
        // Aggregate by (date, ad_unit, site) — when LINE_ITEM_TYPE dimension
        // is present, GAM returns multiple rows per (date, ad_unit, site)
        // (one per type). Sum metrics so the DB unique key
        // (date, ad_unit, site, ...) doesn't get overwritten on upsert.
        const grouped = new Map<string, ParsedReportRow>();
        for (const row of out) {
          const key = `${row.date.toISOString().slice(0, 10)}::${row.adUnit}::${row.site}`;
          const existing = grouped.get(key);
          if (!existing) {
            grouped.set(key, row);
          } else {
            const impSum = existing.impressions + row.impressions;
            const clickSum = existing.clicks + row.clicks;
            const revSum = existing.revenue + row.revenue;
            existing.impressions = impSum;
            existing.clicks = clickSum;
            existing.revenue = revSum;
            // Weighted-average viewability/matchRate; eCPM recalculated from totals.
            existing.ecpm = impSum > 0n ? (revSum / Number(impSum)) * 1000 : 0;
          }
        }
        resolve(Array.from(grouped.values()));
      },
    );
  });
}
