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
}

export async function runRefresh(
  opts: RefreshOptions,
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void },
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
    const rows = await runGamReport({ fromDate, toDate }, log);
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
