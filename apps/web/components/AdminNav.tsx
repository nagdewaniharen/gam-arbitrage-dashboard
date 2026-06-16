import Link from 'next/link';
import { Users, Bell, History, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/alerts', label: 'Alerts', icon: Bell },
  { href: '/admin/audit', label: 'Audit Log', icon: History },
] as const;

export function AdminNav({ current }: { current?: string }) {
  return (
    <nav className="card mb-4 flex items-center gap-2 flex-wrap">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-[--color-text-dim] hover:text-[--color-text] hover:bg-[--color-surface-hover] transition"
      >
        <ArrowLeft size={12} />
        Dashboard
      </Link>
      <span className="text-[--color-text-muted]">·</span>
      {ITEMS.map((it) => {
        const active = current === it.href;
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition',
              active
                ? 'bg-[--color-surface-2] text-[--color-text]'
                : 'text-[--color-text-dim] hover:text-[--color-text] hover:bg-[--color-surface-hover]',
            )}
          >
            <Icon size={12} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
