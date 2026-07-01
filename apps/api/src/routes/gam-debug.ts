import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runGamReport, lastSoapFaultXml, lastSoapRequestXml } from '../services/gam-client.js';
import * as GamClient from '../services/gam-client.js';
import { env } from '../config/env.js';
import { ok } from '../lib/responses.js';

const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const REPORT_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/ReportService`;
const APP_NAME = 'GAM Arbitrage Dashboard';
const REFRESH_TOKEN_PATH = path.resolve(process.cwd(), '../../secrets/gam-user-refresh-token.json');

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadRefreshToken(): Promise<string> {
  if (process.env.GAM_USER_OAUTH_REFRESH_TOKEN) return process.env.GAM_USER_OAUTH_REFRESH_TOKEN;
  const raw = await fs.readFile(REFRESH_TOKEN_PATH, 'utf-8');
  const json = JSON.parse(raw) as { refresh_token?: string };
  if (!json.refresh_token) throw new Error('refresh_token missing');
  return json.refresh_token;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GAM_USER_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GAM_USER_OAUTH_CLIENT_SECRET!;
  const refreshToken = await loadRefreshToken();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');
  return token;
}

/**
 * Run an arbitrary GAM report with caller-specified dims + columns. Used
 * for debugging which dimension names GAM actually accepts on this network.
 */
async function runArbitrary(opts: {
  dims: string[];
  cols: string[];
  fromDate: Date;
  toDate: Date;
}): Promise<{
  status: number;
  fault: string | null;
  csvHeader: string | null;
  csvRow1: string | null;
  rowCount?: number;
  uniqueSecondColCount?: number;
  uniqueSecondColSample?: string[];
}> {
  const accessToken = await getAccessToken();
  const dimsXml = opts.dims.map((d) => `<ns:dimensions>${d}</ns:dimensions>`).join('\n            ');
  const colsXml = opts.cols.map((c) => `<ns:columns>${c}</ns:columns>`).join('\n            ');
  const runBody = `<ns:runReportJob>
    <ns:reportJob>
      <ns:reportQuery>
        ${dimsXml}
        ${colsXml}
        <ns:startDate>
          <ns:year>${opts.fromDate.getUTCFullYear()}</ns:year>
          <ns:month>${opts.fromDate.getUTCMonth() + 1}</ns:month>
          <ns:day>${opts.fromDate.getUTCDate()}</ns:day>
        </ns:startDate>
        <ns:endDate>
          <ns:year>${opts.toDate.getUTCFullYear()}</ns:year>
          <ns:month>${opts.toDate.getUTCMonth() + 1}</ns:month>
          <ns:day>${opts.toDate.getUTCDate()}</ns:day>
        </ns:endDate>
        <ns:dateRangeType>CUSTOM_DATE</ns:dateRangeType>
        <ns:timeZoneType>PUBLISHER</ns:timeZoneType>
      </ns:reportQuery>
    </ns:reportJob>
  </ns:runReportJob>`;
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header>
    <ns:RequestHeader>
      <ns:networkCode>${xmlEscape(env.GAM_NETWORK_CODE)}</ns:networkCode>
      <ns:applicationName>${xmlEscape(APP_NAME)}</ns:applicationName>
    </ns:RequestHeader>
  </soap:Header>
  <soap:Body>${runBody}</soap:Body>
</soap:Envelope>`;
  const res = await fetch(REPORT_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: 'runReportJob',
      Authorization: `Bearer ${accessToken}`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) {
    const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text)?.[1] ?? null;
    return { status: res.status, fault, csvHeader: null, csvRow1: null };
  }
  const jobIdMatch = /<(?:[a-z]+:)?id>([^<]+)<\/(?:[a-z]+:)?id>/.exec(text);
  const jobId = jobIdMatch?.[1];
  if (!jobId) return { status: res.status, fault: 'Could not parse jobId', csvHeader: null, csvRow1: null };

  // Poll for completion.
  const start = Date.now();
  const TIMEOUT_MS = 5 * 60 * 1000;
  let delay = 2000;
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, delay));
    const statusBody = `<ns:getReportJobStatus><ns:reportJobId>${xmlEscape(jobId)}</ns:reportJobId></ns:getReportJobStatus>`;
    const statusEnvelope = envelope.replace(runBody, statusBody);
    const statusRes = await fetch(REPORT_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        SOAPAction: 'getReportJobStatus',
        Authorization: `Bearer ${accessToken}`,
      },
      body: statusEnvelope,
    });
    const statusText = await statusRes.text();
    const status = /<(?:[a-z]+:)?rval>([^<]+)<\/(?:[a-z]+:)?rval>/.exec(statusText)?.[1];
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      const urlBody = `<ns:getReportDownloadUrlWithOptions>
        <ns:reportJobId>${xmlEscape(jobId)}</ns:reportJobId>
        <ns:reportDownloadOptions>
          <ns:exportFormat>CSV_DUMP</ns:exportFormat>
          <ns:useGzipCompression>true</ns:useGzipCompression>
        </ns:reportDownloadOptions>
      </ns:getReportDownloadUrlWithOptions>`;
      const urlEnvelope = envelope.replace(runBody, urlBody);
      const urlRes = await fetch(REPORT_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          SOAPAction: 'getReportDownloadUrlWithOptions',
          Authorization: `Bearer ${accessToken}`,
        },
        body: urlEnvelope,
      });
      const urlText = await urlRes.text();
      const urlMatch = /<(?:[a-z]+:)?rval>([^<]+)<\/(?:[a-z]+:)?rval>/.exec(urlText)?.[1];
      if (!urlMatch) return { status: 200, fault: 'No download URL', csvHeader: null, csvRow1: null };
      const dlUrl = urlMatch.replace(/&amp;/g, '&');
      const dlRes = await fetch(dlUrl);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      let csv: string;
      try { csv = zlib.gunzipSync(buf).toString('utf-8'); } catch { csv = buf.toString('utf-8'); }
      const lines = csv.split('\n').filter((l) => l.trim().length > 0);
      const header = lines[0] ?? null;
      const dataLines = lines.slice(1);
      // Column index 1 is typically the second dimension (i.e., the site
      // dimension). Extract unique values across all rows to see if this dim
      // actually returns subdomain granularity or aggregates to base domain.
      const uniqueSecondCol = new Set<string>();
      for (const line of dataLines) {
        const cols = line.split(',');
        if (cols.length >= 2) uniqueSecondCol.add(cols[1]!);
      }
      return {
        status: 200,
        fault: null,
        csvHeader: header,
        csvRow1: dataLines[0] ?? null,
        rowCount: dataLines.length,
        uniqueSecondColCount: uniqueSecondCol.size,
        uniqueSecondColSample: Array.from(uniqueSecondCol).slice(0, 40),
      };
    }
    if (status === 'FAILED') return { status: 200, fault: `ReportJob FAILED`, csvHeader: null, csvRow1: null };
    delay = Math.min(delay * 1.5, 15000);
  }
  return { status: 200, fault: 'Poll timeout', csvHeader: null, csvRow1: null };
}

export async function gamDebugRoutes(app: FastifyInstance) {
  app.post('/debug/gam/site-attempt', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);

    const log = {
      info: (m: string) => app.log.info(m),
      warn: (m: string) => app.log.warn(m),
      error: (m: string) => app.log.error(m),
    };

    let attemptError: string | null = null;
    try {
      await runGamReport(
        { fromDate: from, toDate: today, columnFamily: 'site_breakdown' },
        log,
      );
    } catch (e) {
      attemptError = (e as Error).message;
    }

    return ok({
      attemptError,
      lastSoapRequestXml: GamClient.lastSoapRequestXml ?? lastSoapRequestXml,
      lastSoapFaultXml: GamClient.lastSoapFaultXml ?? lastSoapFaultXml,
      lastCsvHeader: GamClient.lastCsvHeaderDebug?.header ?? null,
      lastCsvRow1: GamClient.lastCsvHeaderDebug?.row1 ?? null,
    });
  });

  // Exhaustive subdomain probe: tries several dim+column combinations to find
  // one that returns subdomain granularity like the GAM UI shows.
  app.post('/debug/gam/probe-subdomain', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);

    // Test matrix — each entry is one attempt.
    const matrix: { name: string; dims: string[]; cols: string[] }[] = [
      { name: 'SITE_NAME + working-DOMAIN-cols', dims: ['DATE', 'SITE_NAME'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'SITE_ID + working-DOMAIN-cols', dims: ['DATE', 'SITE_ID'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'URL + working-DOMAIN-cols', dims: ['DATE', 'URL'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'HOSTNAME + working-DOMAIN-cols', dims: ['DATE', 'HOSTNAME'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'AD_EXCHANGE_HOSTNAME + working-DOMAIN-cols', dims: ['DATE', 'AD_EXCHANGE_HOSTNAME'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'AD_EXCHANGE_URL + working-DOMAIN-cols', dims: ['DATE', 'AD_EXCHANGE_URL'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'AD_EXCHANGE_SITE_NAME + working-DOMAIN-cols', dims: ['DATE', 'AD_EXCHANGE_SITE_NAME'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
      { name: 'DOMAIN+AD_UNIT_NAME + working-cols', dims: ['DATE', 'AD_UNIT_NAME', 'DOMAIN'], cols: ['AD_EXCHANGE_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS', 'AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE'] },
    ];

    const results: unknown[] = [];
    for (const entry of matrix) {
      try {
        const r = await runArbitrary({ dims: entry.dims, cols: entry.cols, fromDate: from, toDate: today });
        results.push({ name: entry.name, ...r });
      } catch (e) {
        results.push({ name: entry.name, error: (e as Error).message });
      }
    }
    return ok({ results });
  });
}
