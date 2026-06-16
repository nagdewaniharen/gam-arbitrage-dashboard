/**
 * Google Ad Manager Reporting API client.
 *
 * Authentication: service account JSON (read from env path or AWS Secrets Manager).
 * Behaviour:
 *   1. Build a ReportJob (dimensions + metrics + date range, IST timezone).
 *   2. Submit; poll status with exponential backoff up to 10 minutes.
 *   3. Download CSV; pipe through parser; yield row batches.
 *
 * Idempotency: caller upserts on the `gam_reports` unique key.
 */
import { google, admanager_v202405 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import zlib from 'node:zlib';
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

const SCOPE = 'https://www.googleapis.com/auth/dfp';

let cachedAdManager: admanager_v202405.Admanager | null = null;
let cachedNetworkCode: string | null = null;

async function loadServiceAccount(): Promise<Record<string, unknown>> {
  if (process.env.GAM_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GAM_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
  }
  const p = env.GAM_SERVICE_ACCOUNT_JSON_PATH;
  if (!p) {
    throw new Error('GAM_SERVICE_ACCOUNT_JSON_PATH not set and no GAM_SERVICE_ACCOUNT_JSON env');
  }
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const buf = await fs.readFile(abs, 'utf-8');
  return JSON.parse(buf) as Record<string, unknown>;
}

export async function getAdManagerClient(): Promise<{
  client: admanager_v202405.Admanager;
  networkCode: string;
}> {
  if (cachedAdManager && cachedNetworkCode) {
    return { client: cachedAdManager, networkCode: cachedNetworkCode };
  }
  const credentials = await loadServiceAccount();
  const auth = new GoogleAuth({ credentials: credentials as never, scopes: [SCOPE] });
  // Note: googleapis ad manager v202405 namespace
  const am = google.admanager({ version: 'v202405', auth });
  cachedAdManager = am;
  cachedNetworkCode = env.GAM_NETWORK_CODE;
  return { client: am, networkCode: cachedNetworkCode };
}

export interface GamReportRunOptions {
  fromDate: Date; // inclusive
  toDate: Date; // inclusive
  timezone?: string; // default Asia/Kolkata
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
 * Submits a ReportJob to GAM, polls until COMPLETED, downloads the CSV,
 * parses every row, and returns them as ParsedReportRow[].
 *
 * Re-tries the entire flow up to 3 times for transient failures (network blips).
 */
export async function runGamReport(
  opts: GamReportRunOptions,
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void },
): Promise<ParsedReportRow[]> {
  return retry(
    async () => {
      const { client } = await getAdManagerClient();
      // NOTE: googleapis surface for GAM Reports varies by version. This function
      // is intentionally written to be swappable: if the actual node client uses
      // a slightly different method shape, replace `runReportJob` body — the
      // contract (input opts → ParsedReportRow[]) stays stable.
      const { fromDate, toDate, timezone = env.GAM_REPORT_TIMEZONE } = opts;
      const reportQuery = {
        dimensions: [
          'DATE',
          'AD_UNIT_NAME',
          'CUSTOM_TARGETING_VALUE_ID',
        ],
        adUnitView: 'TOP_LEVEL',
        columns: [
          'AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_REQUESTS',
          'AD_EXCHANGE_LINE_ITEM_LEVEL_MATCH_RATE',
        ],
        dateRangeType: 'CUSTOM_DATE',
        startDate: toGamDate(fromDate),
        endDate: toGamDate(toDate),
        timeZoneType: 'AD_EXCHANGE',
      };

      log.info('GAM: submitting ReportJob', {
        from: opts.fromDate,
        to: opts.toDate,
        timezone,
      });

      // The actual googleapis call shape is `client.networks.reports.runReportJob(...)`
      // — but this differs per googleapis version. Below uses a defensive fallback
      // that tries the most common shapes.
      let jobId: string | number | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reportsApi: any = (client as any)?.networks?.reports;
        if (reportsApi?.runReportJob) {
          const resp = await reportsApi.runReportJob({
            requestBody: { reportQuery },
          });
          jobId = resp.data?.id ?? resp.data?.name ?? null;
        }
      } catch (e) {
        log.warn('GAM: runReportJob path failed; using SOAP-fallback if available', e);
      }

      if (jobId === null) {
        // Fallback: in some googleapis versions GAM is reached via XML/SOAP only.
        // For now we throw a structured error so the cron entry logs the cause.
        throw new Error(
          'GAM ReportJob submission not implemented in this googleapis version. ' +
            'Wire `google-ad-manager` (the dedicated SOAP client) or upgrade googleapis once ' +
            'the v202405 REST surface ships.',
        );
      }

      log.info(`GAM: job submitted (${jobId}); polling…`);

      // Poll job status (exponential backoff, max ~10 min)
      const csv = await pollAndDownload(client, jobId, log);
      const rows = await parseGamCsv(csv);
      log.info(`GAM: parsed ${rows.length} rows`);
      return rows;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2_000,
      maxDelayMs: 30_000,
      onRetry: (e, attempt, delay) =>
        log.warn(`GAM run failed (attempt ${attempt}), retrying in ${delay}ms`, e),
    },
  );
}

function toGamDate(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function pollAndDownload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  jobId: string | number,
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void },
): Promise<string> {
  const reportsApi = client?.networks?.reports;
  const start = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  let delay = 2_000;
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, delay));
    let status: string | undefined;
    try {
      const resp = await reportsApi?.getReportJobStatus?.({ reportJobId: jobId });
      status = resp?.data?.status;
    } catch (e) {
      log.warn('GAM: getReportJobStatus failed', e);
    }
    log.info(`GAM: job ${jobId} status=${status ?? '(unknown)'}`);
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      // Get download URL
      const dl = await reportsApi?.getReportDownloadURL?.({
        reportJobId: jobId,
        exportFormat: 'CSV_DUMP',
      });
      const url = dl?.data?.url ?? dl?.data;
      if (!url) throw new Error('No download URL returned by GAM');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GAM CSV download failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Reports are often gzip-encoded
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
