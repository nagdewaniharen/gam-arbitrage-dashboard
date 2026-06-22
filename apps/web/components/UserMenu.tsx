'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogIn, LogOut, ShieldCheck, User as UserIcon, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { signInAction, signOutAction } from '@/lib/auth-actions';

interface MeResponse {
  ok: boolean;
  email?: string;
  role?: 'admin' | 'user';
  name?: string | null;
}

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch('/api/auth/session', { credentials: 'include' });
  if (!res.ok) return { ok: false };
  const body = await res.json();
  if (!body?.user?.email) return { ok: false };
  return {
    ok: true,
    email: body.user.email,
    name: body.user.name ?? null,
    role: (body.role as 'admin' | 'user') ?? 'user',
  };
}

/**
 * Shows the logged-in user's email + role, with a sign-out button.
 * Sign-in / sign-out go through server actions so NextAuth v5 sees the
 * required POST + CSRF — plain <a href> hits the v5 400 wall.
 */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 });

  // If the session probe came back empty, the user isn't signed in. Either
  // SSO isn't configured (Phase 1) or the cookie expired — offer sign-in
  // either way, the server action will no-op safely if SSO is off.
  if (!q.data?.ok) {
    return (
      <form action={signInAction}>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface-2] hover:bg-[--color-surface-hover] transition"
        >
          <LogIn size={12} />
          Sign in
        </button>
      </form>
    );
  }

  const isAdmin = q.data.role === 'admin';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[--color-border] bg-[--color-surface] hover:bg-[--color-surface-hover] transition"
      >
        {isAdmin ? <ShieldCheck size={12} className="text-[--color-success]" /> : <UserIcon size={12} />}
        <span className="max-w-[160px] truncate">{q.data.email}</span>
        <ChevronDown size={11} className={cn('transition', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 z-40 card-2 min-w-[220px] shadow-2xl">
          <div className="text-xs text-[--color-text-dim] mb-2">
            <div className="text-[--color-text]">{q.data.name ?? '—'}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[--color-text-muted] mt-0.5">
              role: <span className={isAdmin ? 'text-[--color-success]' : ''}>{q.data.role}</span>
            </div>
          </div>
          {isAdmin ? (
            <Link
              href="/admin/users"
              onClick={() => setOpen(false)}
              className="block text-xs px-2 py-1.5 rounded hover:bg-[--color-surface-hover] transition"
            >
              Admin panel
            </Link>
          ) : null}
          <form action={signOutAction} className="mt-1">
            <button
              type="submit"
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[--color-surface-hover] transition text-[--color-danger]"
            >
              <span className="inline-flex items-center gap-1.5">
                <LogOut size={11} />
                Sign out
              </span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
