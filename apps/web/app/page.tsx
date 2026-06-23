'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Dimension, Period } from '@gam/types';
import { api, type DateRange } from '@/lib/api';
import { fmt } from '@/lib/format';
import { Header } from '@/components/Header';
import { KpiCard } from '@/components/KpiCard';
import { TrendChart } from '@/components/TrendChart';
import { BreakdownTable } from '@/components/BreakdownTable';
import { Performers } from '@/components/Performers';
import { CrossAnalysis } from '@/components/CrossAnalysis';
import { CsvUpload } from '@/components/CsvUpload';
import { CostRoi } from '@/components/CostRoi';
import { SpendForm } from '@/components/SpendForm';
import { SpendCsvUpload } from '@/components/SpendCsvUpload';
import { CompareDates } from '@/components/CompareDates';
import { EmptyState } from '@/components/EmptyState';
import { Footer } from '@/components/Footer';

const NETWORK_CODE = process.env.NEXT_PUBLIC_NETWORK_CODE ?? '';

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('7d');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  // Stable cache key for queries — switches to date-bracketed key when
  // a custom range is active so TanStack Query refetches correctly.
  const periodKey = customRange ? `custom:${customRange.from}..${customRange.to}` : period;

  const [dimA, setDimA] = useState<Dimension>('campaign');
  // PRD §9.2 wireframe: right breakdown defaults to "Ad Unit"
  const [dimB, setDimB] = useState<Dimension>('ad_unit');

  const [crossDim1, setCrossDim1] = useState<Dimension>('campaign');
  const [crossDim2, setCrossDim2] = useState<Dimension>('source');

  const [topBy, setTopBy] = useState<Dimension>('campaign');
  const [bottomBy, setBottomBy] = useState<Dimension>('campaign');
  const [topMinImpr, setTopMinImpr] = useState<number>(10);
  const [bottomMinImpr, setBottomMinImpr] = useState<number>(10);

  // PRD §10.1 — auto-refresh every 5 min (300_000 ms). Browser tabs that
  // stay open update without a manual refresh button click.
  const REFRESH_MS = 5 * 60 * 1000;
  const stats = useQuery({ queryKey: ['stats', periodKey], queryFn: () => api.stats(period, customRange), refetchInterval: REFRESH_MS });
  const trend = useQuery({ queryKey: ['trend', periodKey], queryFn: () => api.trend(period, customRange), refetchInterval: REFRESH_MS });

  const breakA = useQuery({
    queryKey: ['breakdown', dimA, periodKey],
    queryFn: () => api.breakdown(dimA, period, 100, customRange),
    refetchInterval: REFRESH_MS,
  });
  const breakB = useQuery({
    queryKey: ['breakdown', dimB, periodKey],
    queryFn: () => api.breakdown(dimB, period, 100, customRange),
    refetchInterval: REFRESH_MS,
  });

  const cross = useQuery({
    queryKey: ['cross', crossDim1, crossDim2, periodKey],
    queryFn: () => api.cross(crossDim1, crossDim2, period, 500, customRange),
    enabled: crossDim1 !== crossDim2,
    refetchInterval: REFRESH_MS,
  });

  const top = useQuery({
    queryKey: ['performers', 'top', topBy, periodKey, topMinImpr],
    queryFn: () => api.performers('top', topBy, period, 10, customRange),
    refetchInterval: REFRESH_MS,
  });
  const bot = useQuery({
    queryKey: ['performers', 'bottom', bottomBy, periodKey, bottomMinImpr],
    queryFn: () => api.performers('bottom', bottomBy, period, 10, customRange),
    refetchInterval: REFRESH_MS,
  });

  // Status pings every minute so the "last sync" badge stays accurate.
  const status = useQuery({ queryKey: ['status'], queryFn: () => api.status(), refetchInterval: 60_000 });
  const s = stats.data;
  const dbEmpty = status.data?.totalRows === 0;

  // RPV — Revenue Per Visit. Per PRD §9.3.1 (literal form):
  //   RPV = revenue / (impressions / avg_ads_per_page)
  // avg_ads_per_page is operational config (see ADR-017). Default = 2
  // (verified by counting defineSlot + defineOutOfPageSlot in jobprivet
  // funnel source).
  const AVG_ADS_PER_PAGE = Number(process.env.NEXT_PUBLIC_AVG_ADS_PER_PAGE ?? 2);
  const rpv =
    s && s.totalImpressions > 0 && AVG_ADS_PER_PAGE > 0
      ? s.totalRevenue / (s.totalImpressions / AVG_ADS_PER_PAGE)
      : 0;

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6 max-w-[1480px] mx-auto">
      <Header
        period={period}
        onPeriodChange={setPeriod}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        status={status.data}
        networkCode={NETWORK_CODE}
      />

      {dbEmpty ? (
        <section className="mb-4">
          <EmptyState />
        </section>
      ) : null}

      {/* KPI cards — 7 cards. Mobile (≥360px): 2 cols. md: 3 cols. lg: 7 cols. */}
      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4 mb-4">
        <KpiCard
          label="Revenue"
          value={s ? fmt.usd(s.totalRevenue) : '—'}
          accent="revenue"
          changePct={s?.previousPeriod?.changes.revenuePct}
          loading={stats.isLoading}
        />
        <KpiCard
          label="Impressions"
          value={s ? fmt.num(s.totalImpressions) : '—'}
          accent="impressions"
          changePct={s?.previousPeriod?.changes.impressionsPct}
          loading={stats.isLoading}
        />
        <KpiCard
          label="Avg eCPM"
          value={s ? fmt.ecpm(s.avgEcpm) : '—'}
          accent="ecpm"
          changePct={s?.previousPeriod?.changes.ecpmPct}
          loading={stats.isLoading}
        />
        <KpiCard
          label="Clicks"
          value={s ? fmt.num(s.totalClicks) : '—'}
          sub={s ? `CTR ${fmt.pct(s.ctr)}` : undefined}
          accent="clicks"
          loading={stats.isLoading}
        />
        <KpiCard
          label="Viewability"
          value={s ? fmt.pct(s.viewability) : '—'}
          sub="% viewable impressions"
          accent="viewability"
          loading={stats.isLoading}
        />
        <KpiCard
          label="Match Rate"
          value={s ? fmt.pct(s.matchRate) : '—'}
          sub="% matched requests"
          accent="matchRate"
          loading={stats.isLoading}
        />
        <KpiCard
          label="RPV"
          value={s ? `$${rpv.toFixed(4)}` : '—'}
          sub="Revenue Per Visit"
          accent="revenue"
          loading={stats.isLoading}
        />
      </section>

      {/* Trend */}
      <section className="mb-4">
        <TrendChart points={trend.data?.points ?? []} loading={trend.isLoading} />
      </section>

      {/* Two breakdown tables — default Campaign + Ad Unit per PRD wireframe */}
      <section className="grid lg:grid-cols-2 gap-4 mb-4">
        <BreakdownTable
          dim={dimA}
          rows={breakA.data?.rows ?? []}
          loading={breakA.isLoading}
          onDimChange={setDimA}
          excludeDim={dimB}
        />
        <BreakdownTable
          dim={dimB}
          rows={breakB.data?.rows ?? []}
          loading={breakB.isLoading}
          onDimChange={setDimB}
          excludeDim={dimA}
        />
      </section>

      {/* Top / Bottom performers */}
      <section className="grid lg:grid-cols-2 gap-4 mb-4">
        <Performers
          variant="top"
          by={topBy}
          onByChange={setTopBy}
          minImpressions={topMinImpr}
          onMinImpressionsChange={setTopMinImpr}
          rows={top.data?.rows ?? []}
          loading={top.isLoading}
        />
        <Performers
          variant="bottom"
          by={bottomBy}
          onByChange={setBottomBy}
          minImpressions={bottomMinImpr}
          onMinImpressionsChange={setBottomMinImpr}
          rows={bot.data?.rows ?? []}
          loading={bot.isLoading}
        />
      </section>

      {/* Cross-dim analysis */}
      <section className="mb-4">
        <CrossAnalysis
          dim1={crossDim1}
          dim2={crossDim2}
          rows={cross.data?.rows ?? []}
          onDim1Change={setCrossDim1}
          onDim2Change={setCrossDim2}
          loading={cross.isLoading}
        />
      </section>

      {/* Cost & ROI */}
      <section className="mb-4">
        <CostRoi period={period} />
      </section>

      {/* Date-range compare */}
      <section className="mb-4">
        <CompareDates />
      </section>

      {/* Spend entry (PRD §9.3.7) — manual + CSV side-by-side */}
      <section className="grid lg:grid-cols-2 gap-4 mb-4">
        <SpendForm />
        <SpendCsvUpload />
      </section>

      {/* GAM report CSV upload (fallback per PRD §9.3.8) */}
      <section className="mb-4">
        <CsvUpload />
      </section>

      <Footer status={status.data} />
    </main>
  );
}
