/**
 * Seed script — populates the DB with realistic sample data so the dashboard
 * has something to show before GAM API integration is live.
 *
 * Run with: `pnpm db:seed`
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Read from env so the real network code never lives in source.
const NETWORK_ID = process.env.GAM_NETWORK_CODE ?? 'DEMO_NETWORK';
const DAYS = 30;

const CAMPAIGNS = ['camp_01', 'camp_02', 'camp_03', 'camp_04', 'camp_05', 'camp_06'];
const SOURCES = ['mgid', 'meta', 'sharechat', 'google', 'organic'];
const HEADLINES = ['hl_free_robux', 'hl_jackpot', 'hl_news_alert', 'hl_quiz_win'];
const LANDERS = ['funnel_v1', 'gate_v2', 'quiz_v1', 'article_v3'];
const IMAGES = ['img_1', 'img_2', 'img_3'];
const AD_UNITS = ['site_top', 'site_anchor', 'site_rewarded', 'site_interstitial', 'site_in_content'];
const PAGES = ['/funnel', '/quiz', '/article', '/results'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pickWeighted<T>(rand: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let target = rand() * total;
  for (let i = 0; i < items.length; i++) {
    target -= weights[i]!;
    if (target <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

async function main() {
  console.log('🌱 Seeding database…');

  await prisma.gamReport.deleteMany({});
  await prisma.adSpend.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.cronRun.deleteMany({});

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rand = rng(42);
  const rows: Prisma.GamReportCreateManyInput[] = [];

  for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - dayOffset);

    for (const campaign of CAMPAIGNS) {
      for (const source of SOURCES) {
        // Not every combo appears every day — skip 30%
        if (rand() < 0.3) continue;

        const headline = pickWeighted(rand, HEADLINES, [3, 2, 2, 1]);
        const lander = pickWeighted(rand, LANDERS, [3, 3, 1, 2]);
        const image = IMAGES[Math.floor(rand() * IMAGES.length)]!;
        const adUnit = AD_UNITS[Math.floor(rand() * AD_UNITS.length)]!;
        const page = PAGES[Math.floor(rand() * PAGES.length)]!;

        const baseImpr = 500 + rand() * 4500;
        const sourceMultiplier =
          source === 'mgid' ? 1.4 : source === 'google' ? 1.2 : source === 'meta' ? 1.0 : 0.6;
        const dailyTrend = 1 + Math.sin((DAYS - dayOffset) / 4) * 0.2;
        const impressions = Math.floor(baseImpr * sourceMultiplier * dailyTrend);

        const ctr = 0.005 + rand() * 0.02; // 0.5%–2.5%
        const clicks = Math.floor(impressions * ctr);

        const ecpm = 0.5 + rand() * 4.5; // $0.50 – $5.00 eCPM
        const revenue = (impressions / 1000) * ecpm;

        const viewability = 0.4 + rand() * 0.5;
        const matchRate = 0.6 + rand() * 0.35;

        rows.push({
          networkId: NETWORK_ID,
          date: d,
          campaign,
          source,
          headline,
          lander,
          image,
          adUnit,
          page,
          impressions: BigInt(impressions),
          clicks: BigInt(clicks),
          revenue: new Prisma.Decimal(revenue.toFixed(4)),
          ecpm: new Prisma.Decimal(ecpm.toFixed(4)),
          viewability: new Prisma.Decimal(viewability.toFixed(4)),
          matchRate: new Prisma.Decimal(matchRate.toFixed(4)),
        });
      }
    }
  }

  // Bulk insert in chunks
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.gamReport.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  console.log(`  ✓ Inserted ${rows.length} gam_reports rows`);

  // Sample spend data — manual entries for top campaigns
  const spendRows: Prisma.AdSpendCreateManyInput[] = [];
  for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - dayOffset);
    for (const campaign of CAMPAIGNS.slice(0, 4)) {
      for (const source of ['mgid', 'meta'] as const) {
        spendRows.push({
          networkId: NETWORK_ID,
          date: d,
          campaign,
          source,
          spend: new Prisma.Decimal((20 + rand() * 80).toFixed(4)),
          clicks: BigInt(Math.floor(50 + rand() * 500)),
          impressions: BigInt(Math.floor(1000 + rand() * 5000)),
          enteredBy: 'manual:seed@example.com',
        });
      }
    }
  }
  await prisma.adSpend.createMany({ data: spendRows });
  console.log(`  ✓ Inserted ${spendRows.length} ad_spend rows`);

  // Bootstrap admin (for Phase 2 SSO)
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Bootstrap Admin',
      role: 'admin',
    },
  });
  console.log('  ✓ Bootstrap admin created');

  // Sample successful cron run
  await prisma.cronRun.create({
    data: {
      job: 'gam.refresh',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      finishedAt: new Date(Date.now() - 29 * 60 * 1000),
      rowsAffected: rows.length,
      metadata: { source: 'seed' },
    },
  });

  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
