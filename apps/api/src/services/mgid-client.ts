/**
 * MGID Partner API client — pulls daily spend per campaign and writes it to
 * `ad_spend` keyed on (date × campaign × source='mgid').
 *
 * Status: stub until MGID API key arrives. The shape of the API client is
 * stable; only the actual HTTP call body needs to be confirmed once we have
 * the key + MGID docs in hand.
 */
import { prisma, Prisma } from '@gam/db';
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

export interface MgidSpendRow {
  date: string; // YYYY-MM-DD
  campaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
}

export async function fetchMgidSpend(
  opts: { fromDate: Date; toDate: Date },
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void },
): Promise<MgidSpendRow[]> {
  if (!env.MGID_API_KEY || env.MGID_API_KEY === 'change_me_when_available') {
    log.warn('MGID_API_KEY not configured — skipping MGID pull');
    return [];
  }

  return retry(
    async () => {
      const url = `${env.MGID_API_BASE_URL}/campaigns/statistics`;
      const params = new URLSearchParams({
        dateFrom: opts.fromDate.toISOString().slice(0, 10),
        dateTo: opts.toDate.toISOString().slice(0, 10),
        groupBy: 'campaign,date',
      });
      log.info(`MGID: GET ${url}?${params.toString()}`);
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${env.MGID_API_KEY}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`MGID API error: HTTP ${res.status}`);
      }
      const body = (await res.json()) as { data?: unknown[] };
      const data = Array.isArray(body?.data) ? body.data : [];
      return data.map((r: unknown) => {
        const row = r as Record<string, unknown>;
        return {
          date: String(row.date ?? ''),
          campaignId: String(row.campaign_id ?? row.campaignId ?? ''),
          spend: Number(row.spend ?? 0),
          clicks: Number(row.clicks ?? 0),
          impressions: Number(row.impressions ?? 0),
        };
      });
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      onRetry: (e, attempt, delay) =>
        log.warn(`MGID fetch failed (attempt ${attempt}), retrying in ${delay}ms`, e),
    },
  );
}

export async function syncMgidSpend(
  opts: { daysBack?: number; fromDate?: Date; toDate?: Date; trigger: string },
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void },
): Promise<{ pulled: number; upserted: number; status: 'succeeded' | 'failed' | 'skipped'; error?: string }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysBack = opts.daysBack ?? 7;
  const fromDate = opts.fromDate ?? (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (daysBack - 1));
    return d;
  })();
  const toDate = opts.toDate ?? today;

  const run = await prisma.cronRun.create({
    data: {
      job: 'mgid.refresh',
      status: 'running',
      metadata: { trigger: opts.trigger, fromDate: fromDate.toISOString(), toDate: toDate.toISOString() },
    },
  });

  try {
    const rows = await fetchMgidSpend({ fromDate, toDate }, log);
    if (rows.length === 0) {
      await prisma.cronRun.update({
        where: { id: run.id },
        data: { status: 'succeeded', finishedAt: new Date(), rowsAffected: 0, metadata: { trigger: opts.trigger, note: 'no rows / API not configured' } },
      });
      return { pulled: 0, upserted: 0, status: 'skipped' };
    }
    let upserted = 0;
    for (const r of rows) {
      const d = new Date(r.date);
      if (isNaN(d.getTime())) continue;
      await prisma.adSpend.upsert({
        where: {
          ad_spend_unique_key: {
            networkId: env.GAM_NETWORK_CODE,
            date: d,
            campaign: r.campaignId,
            source: 'mgid',
          },
        },
        create: {
          networkId: env.GAM_NETWORK_CODE,
          date: d,
          campaign: r.campaignId,
          source: 'mgid',
          spend: new Prisma.Decimal(r.spend.toFixed(4)),
          clicks: BigInt(r.clicks),
          impressions: BigInt(r.impressions),
          enteredBy: 'mgid-api',
        },
        update: {
          spend: new Prisma.Decimal(r.spend.toFixed(4)),
          clicks: BigInt(r.clicks),
          impressions: BigInt(r.impressions),
          enteredBy: 'mgid-api',
        },
      });
      upserted += 1;
    }
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { status: 'succeeded', finishedAt: new Date(), rowsAffected: upserted, metadata: { trigger: opts.trigger, pulled: rows.length, upserted } },
    });
    return { pulled: rows.length, upserted, status: 'succeeded' };
  } catch (e) {
    const error = (e as Error).message;
    log.error('MGID sync failed', e);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error, metadata: { trigger: opts.trigger, error } },
    });
    return { pulled: 0, upserted: 0, status: 'failed', error };
  }
}
