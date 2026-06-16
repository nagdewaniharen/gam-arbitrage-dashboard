'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SpendInput {
  date: string;
  campaign: string;
  source: string;
  spend: number;
  clicks?: number;
  impressions?: number;
}

export function SpendForm() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<SpendInput>({
    date: today,
    campaign: '',
    source: 'mgid',
    spend: 0,
  });
  const [message, setMessage] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async (payload: SpendInput) => {
      const res = await fetch(`${BASE}/api/spend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message);
      return body.data;
    },
    onSuccess: () => {
      setMessage(`Saved: ${form.campaign} / ${form.source} on ${form.date}`);
      void qc.invalidateQueries({ queryKey: ['cost-roi'] });
      setTimeout(() => setMessage(null), 3000);
      setForm({ ...form, campaign: '', spend: 0 });
    },
    onError: (e) => {
      setMessage(`Error: ${(e as Error).message}`);
      setTimeout(() => setMessage(null), 4000);
    },
  });

  return (
    <div className="card">
      <div className="flex items-baseline gap-2 mb-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
          Log Ad Spend
        </div>
        <span className="text-[10px] text-[--color-text-muted]">manual entry · admin only</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.campaign || form.spend <= 0) return;
          mut.mutate(form);
        }}
        className="grid grid-cols-2 md:grid-cols-6 gap-2"
      >
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="Campaign"
          value={form.campaign}
          onChange={(e) => setForm({ ...form, campaign: e.target.value })}
          className="input"
          required
        />
        <select
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="input"
        >
          <option value="mgid">mgid</option>
          <option value="meta">meta</option>
          <option value="google">google</option>
          <option value="sharechat">sharechat</option>
          <option value="organic">organic</option>
        </select>
        <input
          type="number"
          placeholder="Spend $"
          value={form.spend || ''}
          onChange={(e) => setForm({ ...form, spend: Number(e.target.value) })}
          className="input font-mono-num"
          min={0}
          step={0.01}
          required
        />
        <input
          type="number"
          placeholder="Clicks"
          value={form.clicks ?? ''}
          onChange={(e) => setForm({ ...form, clicks: e.target.value ? Number(e.target.value) : undefined })}
          className="input font-mono-num"
          min={0}
        />
        <button
          type="submit"
          disabled={mut.isPending || !form.campaign || form.spend <= 0}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
            'border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition',
          )}
        >
          <Plus size={12} />
          {mut.isPending ? 'Saving' : 'Add'}
        </button>
      </form>
      {message ? (
        <div className="mt-2 text-xs text-[--color-text-dim]">{message}</div>
      ) : null}
    </div>
  );
}
