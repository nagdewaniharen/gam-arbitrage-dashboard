'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Dimension, Period } from '@gam/types';
import { api } from '@/lib/api';
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
import { CompareDates } from '@/components/CompareDates';
import { EmptyState } from '@/components/EmptyState';
import { Footer } from '@/components/Footer';

const NETWORK_CODE = process.env.NEXT_PUBLIC_NETWORK_CODE ?? '';

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('7d');

  const [dimA, setDimA] = useState<Dimension>('campaign');
  // PRD §9.2 wireframe: right breakdown defaults to "Ad Unit"
  const [dimB, setDimB] = useState<Dimension>('ad_unit');

  const [crossDim1, setCrossDim1] = useState<Dimension>('campaign');
  const [crossDim2, setCrossDim2] = useState<Dimension>('source');

  const [topBy, setTopBy] = useState<Dimension>('campaign');
  const [bottomBy, setBottomBy] = useState<Dimension>('campaign');
  const [topMinImpr, setTopMinImpr] = useState<number>(10);
  const [bottomMinImpr, setBottomMinImpr] = useState<number>(10);

  const stats = useQuery({ queryKey: ['stats', period], queryFn: () => api.stats(period) });
  const trend = useQuery({ queryKey: ['trend', period], queryFn: () => api.trend(period) });

  const breakA = useQuery({
    queryKey: ['breakdown', dimA, period],
    queryFn: () => api.breakdown(dimA, period, 100),
  });
  const breakB = useQuery({
    queryKey: ['breakdown', dimB, period],
    queryFn: () => api.breakdown(dimB, period, 100),
  });

  const cross = useQuery({
    queryKey: ['cross', crossDim1, crossDim2, period],
    queryFn: () => api.cross(crossDim1, crossDim2, period, 500),
    enabled: crossDim1 !== crossDim2,
  });

  const top = useQuery({
    queryKey: ['performers', 'top', topBy, period, topMinImpr],
    queryFn: () => api.performers('top', topBy, period, 10),
  });
  const bot = useQuery({
    queryKey: ['performers', 'bottom', bottomBy, period, bottomMinImpr],
    queryFn: () => api.performers('bottom', bottomBy, period, 10),
  });

  const status = useQuery({ queryKey: ['status'], queryFn: () => api.status() });
  const s = stats.data;
  const dbEmpty = status.data?.totalRows === 0;

  // RPV — Revenue Per Visit. Per PRD §9.3.1:
  //   RPV = revenue / (impressions / avg_ads_per_page)
  // avg_ads_per_page is operational config (see ADR-017). Default = 2 (verified
  // by counting defineSlot + defineOutOfPageSlot in jobprivet funnel source).
  const AVG_ADS_PER_PAGE = Number(process.env.NEXT_PUBLIC_AVG_ADS_PER_PAGE ?? 2);
  const rpv =
    s && s.totalImpressions > 0
      ? (s.totalRevenue * AVG_ADS_PER_PAGE) / s.totalImpressions
      : 0;

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6 max-w-[1480px] mx-auto">
      <Header
        period={period}
        onPeriodChange={setPeriod}
        status={status.data}
        networkCode={NETWORK_CODE}
      />

      {dbEmpty ? (
        <section className="mb-4">
          <EmptyState />
        </section>
      ) : null}

      {/* KPI cards — 5 cards including RPV */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
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
          label="RPV"
          value={s ? `$${rpv.toFixed(4)}` : '—'}
          sub="Revenue / Impression"
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

      {/* Spend entry */}
      <section className="mb-4">
        <SpendForm />
      </section>

      {/* CSV upload */}
      <section className="mb-4">
        <CsvUpload />
      </section>

      <Footer status={status.data} />
    </main>
  );
}
