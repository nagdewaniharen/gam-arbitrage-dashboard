'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { AdminNav } from '@/components/AdminNav';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  comparison: string;
  threshold: number;
  isEnabled: boolean;
  createdAt: string;
}

export default function AlertsAdminPage() {
  const qc = useQueryClient();
  const q = useQuery<AlertRule[]>({
    queryKey: ['alert-rules'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/alerts/rules`, { credentials: 'include' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message);
      return body.data;
    },
  });

  const [form, setForm] = useState({
    name: 'eCPM drop alert',
    metric: 'ecpm',
    comparison: 'drop_pct_vs_7d_avg',
    threshold: 20,
  });

  const create = useMutation({
    mutationFn: async (input: typeof form) => {
      const res = await fetch(`${BASE}/api/alerts/rules`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/api/alerts/rules/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const evaluate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/alerts/evaluate`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6 max-w-[1080px] mx-auto">
      <h1 className="text-[20px] font-semibold tracking-tight mb-1">Alert rules</h1>
      <p className="text-xs text-[--color-text-dim] mb-4">
        Fire to Slack when a metric crosses a threshold.
      </p>
      <AdminNav current="/admin/alerts" />

      {/* Create form */}
      <div className="card mb-4">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted] mb-3">
          New rule
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(form);
          }}
          className="grid grid-cols-2 md:grid-cols-5 gap-2"
        >
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Rule name"
            className="input col-span-2"
            required
          />
          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="input">
            <option value="ecpm">eCPM</option>
            <option value="revenue">Revenue</option>
            <option value="match_rate">Match rate</option>
          </select>
          <select value={form.comparison} onChange={(e) => setForm({ ...form, comparison: e.target.value })} className="input">
            <option value="drop_pct_vs_7d_avg">drops &gt; X% vs 7d avg</option>
            <option value="below_absolute">below absolute X</option>
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
              className="input font-mono-num flex-1"
              required
            />
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
        </form>
      </div>

      {/* Existing rules */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Rules ({q.data?.length ?? 0})
          </div>
          <button
            type="button"
            onClick={() => evaluate.mutate()}
            disabled={evaluate.isPending}
            className="text-xs px-3 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
          >
            {evaluate.isPending ? 'Evaluating…' : 'Evaluate now'}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
            <tr>
              <th className="text-left pb-2 font-medium">Name</th>
              <th className="text-left pb-2 font-medium">Metric</th>
              <th className="text-left pb-2 font-medium">Comparison</th>
              <th className="text-right pb-2 font-medium">Threshold</th>
              <th className="text-right pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={5} className="py-2"><div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" /></td></tr>
            ) : !q.data?.length ? (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-[--color-text-muted]">No rules yet</td></tr>
            ) : (
              q.data.map((r) => (
                <tr key={r.id} className="border-t border-[--color-border] row-hover">
                  <td className="py-2 text-[--color-text]">{r.name}</td>
                  <td className="text-[--color-text-dim]">{r.metric}</td>
                  <td className="text-[--color-text-dim] text-xs">{r.comparison}</td>
                  <td className="text-right font-mono-num">{r.threshold}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => del.mutate(r.id)}
                      disabled={del.isPending}
                      className="text-xs px-2 py-1 rounded border border-[--color-border] hover:bg-[--color-danger]/10 hover:text-[--color-danger] transition inline-flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
