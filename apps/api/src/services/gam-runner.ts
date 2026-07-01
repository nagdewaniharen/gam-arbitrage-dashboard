/**
 * The orchestrator that ties: GAM client → parser → DB upsert → audit log.
 * Used by:
 *   - POST /api/refresh           (manual trigger by admin)
 *   - POST /internal/cron/refresh (EventBridge hourly)
 *   - One-shot CLI (`pnpm gam:backfill`)
 */
import { prisma, Prisma } from '@gam/db';
import { env } from '../config/env.js';
import { runGamReport } from './gam-client.js';
import type { ParsedReportRow } from './gam-client.js';

export interface RefreshOptions {
  /** Days back from today to fetch (inclusive). Defaults to env.GAM_INCREMENTAL_DAYS_PER_RUN. */
  daysBack?: number;
  /** Override the start date entirely (used for backfills). If set, ignores daysBack. */
  fromDate?: Date;
  toDate?: Date;
  /** Free-form actor for audit log. */
  trigger: string;
}

export interface RefreshResult {
  runId: string;
  status: 'succeeded' | 'failed';
  fromDate: string;
  toDate: string;
  rowsParsed: number;
  rowsUpserted: number;
  durationMs: number;
  error?: string;
  siteQueryRows?: number;
  siteQueryError?: string | null;
  adUnitsWithSites?: number;
  uniqueSitesInBreakdown?: string[];
}

export async function runRefresh(
  opts: RefreshOptions,
  log: { info: (_m: string, _e?: unknown) => void; warn: (_m: string, _e?: unknown) => void; error: (_m: string, _e?: unknown) => void },
): Promise<RefreshResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysBack = opts.daysBack ?? env.GAM_INCREMENTAL_DAYS_PER_RUN;
  const fromDate = opts.fromDate ?? (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (daysBack - 1));
    return d;
  })();
  const toDate = opts.toDate ?? today;

  const run = await prisma.cronRun.create({
    data: {
      job: 'gam.refresh',
      status: 'running', 
      startedAt: new Date(),
      metadata: {
        trigger: opts.trigger,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
    },
  });

  const start = Date.now();
  try {
    log.info(`gam.refresh: ${fromDate.toISOString()} → ${toDate.toISOString()}`);
    // Two GAM queries: (1) line-item-attributed totals matching GAM UI, and
    // (2) network-aggregate viewability + match-rate. GAM rejects viewability
    // columns when LINE_ITEM_TYPE dim is present, so they live in a separate
    // call and we merge by (date, ad_unit) below.
    const rowsCore: ParsedReportRow[] = await runGamReport(
      { fromDate, toDate, columnFamily: 'total_line_item_level' },
      log,
    );
    const rowsViewability: ParsedReportRow[] = await runGamReport(
      { fromDate, toDate, columnFamily: 'viewability_metrics' },
      log,
    ).catch((e) => {
      log.warn(`viewability query failed (non-fatal): ${(e as Error).message}`);
      return [];
    });
    // Third query — per (date, ad_unit, site) AdX impressions, used only to
    // compute impression shares per site so we can attribute TOTAL_* revenue
    // proportionally. GAM's SOAP API name for the "Site" dimension shown in
    // Interactive Reports is AD_EXCHANGE_SITE_NAME.
    let siteQueryError: string | null = null;
    const rowsSite: ParsedReportRow[] = await runGamReport(
      { fromDate, toDate, columnFamily: 'site_breakdown' },
      log,
    ).catch((e) => {
      siteQueryError = (e as Error).message;
      log.warn(`site_breakdown query failed (non-fatal): ${siteQueryError}`);
      return [];
    });
    const viewabilityByKey = new Map<string, { viewability: number; matchRate: number }>();
    for (const r of rowsViewability) {
      const key = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      viewabilityByKey.set(key, { viewability: r.viewability, matchRate: r.matchRate });
    }
    // Build (date, ad_unit) -> [ { site, impressions } ] so we can split each
    // TOTAL_* row into per-site rows weighted by that site's impression share.
    const siteSharesByKey = new Map<string, { site: string; impressions: bigint }[]>();
    for (const r of rowsSite) {
      if (!r.site) continue;
      const key = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      let arr = siteSharesByKey.get(key);
      if (!arr) {
        arr = [];
        siteSharesByKey.set(key, arr);
      }
      const existing = arr.find((s) => s.site === r.site);
      if (existing) existing.impressions += r.impressions;
      else arr.push({ site: r.site, impressions: r.impressions });
    }
    const rows: ParsedReportRow[] = [];
    for (const r of rowsCore) {
      const key = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      const v = viewabilityByKey.get(key);
      const merged = v
        ? { ...r, viewability: v.viewability, matchRate: v.matchRate }
        : r;
      const shares = siteSharesByKey.get(key);
      if (!shares || shares.length === 0) {
        rows.push(merged);
        continue;
      }
      const totalImp = shares.reduce((a, s) => a + s.impressions, 0n);
      if (totalImp === 0n) {
        rows.push(merged);
        continue;
      }
      // Split the row across sites by AdX impression share. Give the remainder
      // to the largest site so per-day totals reconcile exactly.
      let allocImp = 0n;
      let allocClicks = 0n;
      let allocRev = 0;
      const sorted = [...shares].sort((a, b) => (b.impressions > a.impressions ? 1 : -1));
      sorted.forEach((s, idx) => {
        const isLast = idx === sorted.length - 1;
        const share = Number(s.impressions) / Number(totalImp);
        const imp = isLast
          ? merged.impressions - allocImp
          : BigInt(Math.floor(Number(merged.impressions) * share));
        const clicks = isLast
          ? merged.clicks - allocClicks
          : BigInt(Math.floor(Number(merged.clicks) * share));
        const revenue = isLast
          ? Math.max(0, merged.revenue - allocRev)
          : merged.revenue * share;
        allocImp += imp;
        allocClicks += clicks;
        allocRev += revenue;
        rows.push({
          ...merged,
          site: s.site,
          impressions: imp,
          clicks,
          revenue,
          ecpm: imp > 0n ? (revenue / Number(imp)) * 1000 : 0,
        });
      });
    }
    const uniqueSites = new Set<string>();
    for (const r of rowsSite) if (r.site) uniqueSites.add(r.site);
    log.info(
      `gam.refresh: split ${rowsCore.length} core rows into ${rows.length} site-attributed rows ` +
        `(${siteSharesByKey.size} ad-units carry site breakdown, ${rowsViewability.length} viewability rows merged, ` +
        `${uniqueSites.size} unique sites)`,
    );
    // Clear existing rows in this date range before upserting. This keeps the
    // DB in sync with GAM's source of truth — if a (date, ad_unit) drops out
    // of the report (e.g., because column-family / dimension changes filtered
    // it out), the stale row gets removed instead of lingering with old data.
    const fromIso = fromDate.toISOString().slice(0, 10);
    const toIso = toDate.toISOString().slice(0, 10);
    const deleted = await prisma.gamReport.deleteMany({
      where: { date: { gte: new Date(fromIso), lte: new Date(toIso) } },
    });
    log.info(`gam.refresh: cleared ${deleted.count} stale rows in [${fromIso}, ${toIso}]`);
    const upserted = await upsertRows(rows);
    const durationMs = Date.now() - start;

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        rowsAffected: upserted,
        metadata: { trigger: opts.trigger, parsed: rows.length, upserted, durationMs },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorEmail: opts.trigger,
        action: 'cron.refresh.success',
        target: 'gam_reports',
        metadata: { parsed: rows.length, upserted, durationMs },
      },
    });

    return {
      runId: run.id.toString(),
      status: 'succeeded',
      fromDate: fromDate.toISOString().slice(0, 10),
      toDate: toDate.toISOString().slice(0, 10),
      rowsParsed: rows.length,
      rowsUpserted: upserted,
      durationMs,
      siteQueryRows: rowsSite.length,
      siteQueryError,
      adUnitsWithSites: siteSharesByKey.size,
      uniqueSitesInBreakdown: Array.from(uniqueSites).slice(0, 30),
    };
  } catch (e) {
    const error = (e as Error).message;
    log.error('gam.refresh failed', e);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error,
        metadata: { trigger: opts.trigger, error },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorEmail: opts.trigger,
        action: 'cron.refresh.failure',
        target: 'gam_reports',
        metadata: { error },
      },
    });
    return {
      runId: run.id.toString(),
      status: 'failed',
      fromDate: fromDate.toISOString().slice(0, 10),
      toDate: toDate.toISOString().slice(0, 10),
      rowsParsed: 0,
      rowsUpserted: 0,
      durationMs: Date.now() - start,
      error,
    };
  }
}

const CHUNK = 200;

async function upsertRows(rows: ParsedReportRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.gamReport.upsert({
          where: {
            gam_reports_unique_key: {
              networkId: env.GAM_NETWORK_CODE,
              date: r.date,
              campaign: r.campaign,
              source: r.source,
              headline: r.headline,
              lander: r.lander,
              image: r.image,
              adUnit: r.adUnit,
              site: r.site,
              page: r.page,
            },
          },
          create: {
            networkId: env.GAM_NETWORK_CODE,
            date: r.date,
            campaign: r.campaign,
            source: r.source,
            headline: r.headline,
            lander: r.lander,
            image: r.image,
            adUnit: r.adUnit,
            site: r.site,
            page: r.page,
            impressions: r.impressions,
            clicks: r.clicks,
            revenue: new Prisma.Decimal(r.revenue.toFixed(4)),
            ecpm: new Prisma.Decimal(r.ecpm.toFixed(4)),
            viewability: new Prisma.Decimal(r.viewability.toFixed(4)),
            matchRate: new Prisma.Decimal(r.matchRate.toFixed(4)),
          },
          update: {
            impressions: r.impressions,
            clicks: r.clicks,
            revenue: new Prisma.Decimal(r.revenue.toFixed(4)),
            ecpm: new Prisma.Decimal(r.ecpm.toFixed(4)),
            viewability: new Prisma.Decimal(r.viewability.toFixed(4)),
            matchRate: new Prisma.Decimal(r.matchRate.toFixed(4)),
            fetchedAt: new Date(),
          },
        }),
      ),
    );
    upserted += chunk.length;
  }
  return upserted;
}
