'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { AdminNav } from '@/components/AdminNav';
import { formatIST } from '@/lib/time';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function AuditPage() {
  const [filter, setFilter] = useState('');
  const q = useQuery<AuditRow[]>({
    queryKey: ['audit-log', filter],
    queryFn: async () => {
      const url = new URL(`${BASE}/api/audit-log`);
      url.searchParams.set('limit', '200');
      if (filter) url.searchParams.set('action', filter);
      const res = await fetch(url.toString(), { credentials: 'include' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message);
      return body.data;
    },
  });

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6 max-w-[1200px] mx-auto">
      <h1 className="text-[20px] font-semibold tracking-tight mb-1">Audit log</h1>
      <p className="text-xs text-[--color-text-dim] mb-4">
        Every mutating action — admin refreshes, CSV uploads, spend entries, user role changes.
      </p>
      <AdminNav current="/admin/audit" />

      <div className="card">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
            Entries ({q.data?.length ?? 0})
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[--color-text-muted]" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by action…"
              className="input pl-7 w-48"
            />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
            <tr>
              <th className="text-left pb-2 font-medium">When (IST)</th>
              <th className="text-left pb-2 font-medium">Actor</th>
              <th className="text-left pb-2 font-medium">Action</th>
              <th className="text-left pb-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={4} className="py-2"><div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" /></td></tr>
            ) : !q.data?.length ? (
              <tr><td colSpan={4} className="py-8 text-center text-sm text-[--color-text-muted]">No entries</td></tr>
            ) : (
              q.data.map((r) => (
                <tr key={r.id} className="border-t border-[--color-border] row-hover">
                  <td className="py-1.5 text-[--color-text-dim] font-mono-num text-xs">{formatIST(r.createdAt)}</td>
                  <td className="text-[--color-text]">{r.actorEmail}</td>
                  <td className="text-[--color-text-dim] font-mono-num text-xs">{r.action}</td>
                  <td className="text-[--color-text-dim] truncate max-w-[400px]" title={r.target ?? ''}>{r.target ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
