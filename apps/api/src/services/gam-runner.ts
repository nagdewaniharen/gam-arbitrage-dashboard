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
    // Third query: per-(date, ad_unit, domain) impression counts. Feeds the
    // per-site impression-share split below. DOMAIN can't ride alongside
    // TOTAL_LINE_ITEM_LEVEL_*, hence the separate query.
    let siteQueryError: string | undefined;
    const rowsSite: ParsedReportRow[] = await runGamReport(
      { fromDate, toDate, columnFamily: 'site_breakdown' },
      log,
    ).catch((e) => {
      siteQueryError = (e as Error).message;
      log.warn(`site_breakdown query failed (non-fatal): ${siteQueryError}`);
      return [];
    });
    log.info(
      `gam.refresh: site_breakdown returned ${rowsSite.length} rows, ` +
        `${rowsSite.filter((r) => r.site).length} with non-empty site`,
    );
    if (rowsSite.length > 0) {
      const sampleSites = new Set(rowsSite.map((r) => r.site).filter(Boolean));
      log.info(`gam.refresh: unique sites in breakdown: ${Array.from(sampleSites).slice(0, 10).join(', ')}`);
    }
    const viewabilityByKey = new Map<string, { viewability: number; matchRate: number }>();
    for (const r of rowsViewability) {
      // Both core and viewability queries run without DOMAIN, so site is
      // always '' on both sides — key by (date, ad_unit) only.
      const key = `${r.date.toISOString().slice(0, 10)}::${r.adUnit}`;
      viewabilityByKey.set(key, { viewability: r.viewability, matchRate: r.matchRate });
    }
    // Build (date, ad_unit) -> [ { site, impressions } ] so we can split each
    // TOTAL_* row into one row per site, weighted by that site's impression
    // share for the ad unit that day. Preserves per-site attribution for
    // accurate filtering — see docs (dominant-site tagging was tried and
    // lost >90% of jobprivet.com traffic because most ad-units had a
    // different dominant site per day).
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
      const withViewability = v
        ? { ...r, viewability: v.viewability, matchRate: v.matchRate }
        : r;
      const shares = siteSharesByKey.get(key);
      if (!shares || shares.length === 0) {
        // No site data for this (date, ad_unit) — keep as-is with empty site.
        rows.push(withViewability);
        continue;
      }
      const totalSiteImp = shares.reduce((a, s) => a + s.impressions, 0n);
      if (totalSiteImp === 0n) {
        rows.push(withViewability);
        continue;
      }
      // Split the TOTAL_* row into per-site rows using AD_EXCHANGE impression
      // shares as the weighting. If AD_EXCHANGE and TOTAL_* diverge a bit
      // (Preferred Deals / PG), the split is still directionally correct.
      let allocatedImp = 0n;
      let allocatedClicks = 0n;
      let allocatedRevenue = 0;
      const sortedShares = [...shares].sort((a, b) => (b.impressions > a.impressions ? 1 : -1));
      sortedShares.forEach((s, idx) => {
        const isLast = idx === sortedShares.length - 1;
        // Weight metrics by this site's impression share.
        const share = Number(s.impressions) / Number(totalSiteImp);
        // Use fractional allocation for all-but-last, then give remainder to
        // the last (biggest) site so totals reconcile exactly.
        const imp = isLast
          ? withViewability.impressions - allocatedImp
          : BigInt(Math.floor(Number(withViewability.impressions) * share));
        const clicks = isLast
          ? withViewability.clicks - allocatedClicks
          : BigInt(Math.floor(Number(withViewability.clicks) * share));
        const revenue = isLast
          ? Math.max(0, withViewability.revenue - allocatedRevenue)
          : withViewability.revenue * share;
        allocatedImp += imp;
        allocatedClicks += clicks;
        allocatedRevenue += revenue;
        rows.push({
          ...withViewability,
          site: s.site,
          impressions: imp,
          clicks,
          revenue,
          ecpm: imp > 0n ? (revenue / Number(imp)) * 1000 : 0,
        });
      });
    }
    log.info(
      `gam.refresh: split ${rowsCore.length} core rows into ${rows.length} site-attributed rows ` +
        `(${siteSharesByKey.size} ad-units carry site breakdown, ${rowsViewability.length} viewability rows merged)`,
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
        metadata: {
          trigger: opts.trigger,
          parsed: rows.length,
          upserted,
          durationMs,
          siteQueryRows: rowsSite.length,
          siteQueryError: siteQueryError ?? null,
          adUnitsWithSites: siteSharesByKey.size,
        },
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

    const uniqueSites = new Set<string>();
    for (const r of rowsSite) if (r.site) uniqueSites.add(r.site);
    return {
      runId: run.id.toString(),
      status: 'succeeded',
      fromDate: fromDate.toISOString().slice(0, 10),
      toDate: toDate.toISOString().slice(0, 10),
      rowsParsed: rows.length,
      rowsUpserted: upserted,
      durationMs,
      siteQueryRows: rowsSite.length,
      siteQueryError: siteQueryError ?? null,
      adUnitsWithSites: siteSharesByKey.size,
      uniqueSitesInBreakdown: Array.from(uniqueSites).slice(0, 20),
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
