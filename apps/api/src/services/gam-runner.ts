/**
 * The orchestrator that ties: GAM client → parser → DB upsert → audit log.
 * Used by:
 *   - POST /api/refresh           (manual trigger by admin)
 *   - POST /internal/cron/refresh (EventBridge hourly)
 *   - One-shot CLI (`pnpm gam:backfill`)
 */
import { prisma, Prisma } from '@gam/db';
import { env } from '../config/env.js';
import * as GamClient from './gam-client.js';
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
  lastCsvHeader?: string | null;
  lastCsvRow1?: string | null;
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
    // NOTE: GAM's SOAP API on this network silently drops every site-related
    // dimension (DOMAIN, SITE_NAME, AD_EXCHANGE_SITE_NAME, URL, AD_EXCHANGE_URL).
    // Instead of querying GAM for site data, we snapshot the per-(ad_unit) site
    // distribution from previously-uploaded CSV rows and apply it as a mapping
    // to fresh GAM totals. Workflow:
    //   1. Upload a CSV once with site-tagged rows (site column populated).
    //   2. Every subsequent refresh preserves that mapping — TOTAL_* rows get
    //      split into per-site rows in the same proportions the CSV described.
    // Result: site filter stays accurate + GAM numbers stay fresh.
    const siteQueryError: string | null = null;
    const rowsSite: ParsedReportRow[] = [];
    const viewabilityByKey = new Map<string, { viewability: number; matchRate: number }>();
    for (const r of rowsViewability) {
      const key = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      viewabilityByKey.set(key, { viewability: r.viewability, matchRate: r.matchRate });
    }
    // Snapshot pre-existing site-tagged rows as the mapping template.
    const fromIso = fromDate.toISOString().slice(0, 10);
    const toIso = toDate.toISOString().slice(0, 10);
    const preExistingSiteRows = await prisma.gamReport.findMany({
      where: {
        NOT: { site: '' },
        impressions: { gt: 0 },
      },
      select: { adUnit: true, site: true, impressions: true },
    });
    const siteMappingByAdUnit = new Map<string, Map<string, bigint>>();
    for (const r of preExistingSiteRows) {
      let inner = siteMappingByAdUnit.get(r.adUnit);
      if (!inner) {
        inner = new Map();
        siteMappingByAdUnit.set(r.adUnit, inner);
      }
      inner.set(r.site, (inner.get(r.site) ?? 0n) + r.impressions);
    }
    log.info(
      `gam.refresh: snapshotted site mapping for ${siteMappingByAdUnit.size} ad units ` +
        `from ${preExistingSiteRows.length} pre-existing CSV rows`,
    );
    const rows: ParsedReportRow[] = [];
    for (const r of rowsCore) {
      const viewKey = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      const v = viewabilityByKey.get(viewKey);
      const merged = v
        ? { ...r, viewability: v.viewability, matchRate: v.matchRate }
        : r;
      const mapping = siteMappingByAdUnit.get(r.adUnit);
      if (!mapping || mapping.size === 0) {
        rows.push(merged);
        continue;
      }
      const totalMapped = Array.from(mapping.values()).reduce((a, x) => a + x, 0n);
      if (totalMapped === 0n) {
        rows.push(merged);
        continue;
      }
      // Split the row across sites using CSV's impression proportions. Give the
      // remainder to the largest site so per-ad-unit totals reconcile exactly.
      let allocImp = 0n;
      let allocClicks = 0n;
      let allocRev = 0;
      const sortedShares = Array.from(mapping.entries())
        .map(([site, impressions]) => ({ site, impressions }))
        .sort((a, b) => (b.impressions > a.impressions ? 1 : -1));
      sortedShares.forEach((s, idx) => {
        const isLast = idx === sortedShares.length - 1;
        const share = Number(s.impressions) / Number(totalMapped);
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
    for (const inner of siteMappingByAdUnit.values()) {
      for (const site of inner.keys()) uniqueSites.add(site);
    }
    log.info(
      `gam.refresh: split ${rowsCore.length} core rows into ${rows.length} site-attributed rows ` +
        `(${siteMappingByAdUnit.size} ad units carry CSV mapping, ${rowsViewability.length} viewability rows merged, ` +
        `${uniqueSites.size} unique sites)`,
    );
    // Clear existing rows in this date range before upserting. This keeps the
    // DB in sync with GAM's source of truth for TOTAL metrics; the site
    // mapping we snapshotted above lives on the incoming rows via the split.
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
      adUnitsWithSites: siteMappingByAdUnit.size,
      uniqueSitesInBreakdown: Array.from(uniqueSites).slice(0, 30),
      lastCsvHeader: GamClient.lastCsvHeaderDebug?.header ?? null,
      lastCsvRow1: GamClient.lastCsvHeaderDebug?.row1 ?? null,
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
