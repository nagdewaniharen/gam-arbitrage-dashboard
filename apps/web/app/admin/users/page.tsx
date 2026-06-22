'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Shield } from 'lucide-react';
import { AdminNav } from '@/components/AdminNav';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

async function fetchUsers(): Promise<UserRow[]> {
  const res = await fetch(`${BASE}/api/users`, { credentials: 'include' });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message);
  return body.data;
}

export default function UsersAdminPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: fetchUsers });

  const update = useMutation({
    mutationFn: async (input: { id: string; role?: 'admin' | 'user'; isActive?: boolean }) => {
      const { id, ...body } = input;
      const res = await fetch(`${BASE}/api/users/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6 max-w-[1080px] mx-auto">
      <h1 className="text-[20px] font-semibold tracking-tight mb-1">Users</h1>
      <p className="text-xs text-[--color-text-dim] mb-4">Manage access to the dashboard.</p>
      <AdminNav current="/admin/users" />

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-[--color-text-muted] text-[10px] font-medium uppercase tracking-[0.1em]">
            <tr>
              <th className="text-left pb-2 font-medium">Email</th>
              <th className="text-left pb-2 font-medium">Name</th>
              <th className="text-left pb-2 font-medium">Role</th>
              <th className="text-left pb-2 font-medium">Active</th>
              <th className="text-left pb-2 font-medium">Last login</th>
              <th className="text-right pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-t border-[--color-border]">
                  <td colSpan={6} className="py-2">
                    <div className="h-3 w-full rounded bg-[--color-surface-2] animate-pulse" />
                  </td>
                </tr>
              ))
            ) : !q.data?.length ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-[--color-text-muted]">
                  No users yet — sign in once to seed the first row.
                </td>
              </tr>
            ) : (
              q.data.map((u) => (
                <tr key={u.id} className="border-t border-[--color-border] row-hover">
                  <td className="py-2 text-[--color-text]">{u.email}</td>
                  <td className="text-[--color-text-dim]">{u.name ?? '—'}</td>
                  <td>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded',
                        u.role === 'admin'
                          ? 'text-[--color-accent-revenue] bg-[--color-accent-revenue]/10'
                          : 'text-[--color-text-dim] bg-[--color-surface-2]',
                      )}
                    >
                      {u.role === 'admin' ? <ShieldCheck size={11} /> : <Shield size={11} />}
                      {u.role}
                    </span>
                  </td>
                  <td className={u.isActive ? 'text-[--color-success]' : 'text-[--color-danger]'}>
                    {u.isActive ? '● yes' : '● no'}
                  </td>
                  <td className="text-[--color-text-dim] text-xs">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => update.mutate({ id: u.id, role: u.role === 'admin' ? 'user' : 'admin' })}
                      disabled={update.isPending}
                      className="text-xs px-2 py-1 rounded border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] mr-1.5 transition"
                    >
                      Make {u.role === 'admin' ? 'user' : 'admin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}
                      disabled={update.isPending}
                      className="text-xs px-2 py-1 rounded border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
                    >
                      {u.isActive ? 'Deactivate' : 'Activate'}
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
