'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export function SiteFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (_sites: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const sitesQ = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.sites(),
    staleTime: 5 * 60 * 1000,
  });
  const allSites = sitesQ.data?.sites ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allSites;
    return allSites.filter((s) => s.toLowerCase().includes(q));
  }, [allSites, search]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSelected = value.length === 0;
  const label = allSelected
    ? 'All sites'
    : value.length === 1
      ? value[0]
      : `${value.length} sites`;

  function toggle(site: string) {
    if (selectedSet.has(site)) {
      onChange(value.filter((s) => s !== site));
    } else {
      onChange([...value, site]);
    }
  }

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
          'border border-[--color-border] transition',
          allSelected
            ? 'bg-[--color-surface] text-[--color-text-dim] hover:text-[--color-text]'
            : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
        )}
        title={allSelected ? 'Filter by site' : value.join(', ')}
      >
        <Globe size={12} />
        <span className="max-w-[160px] truncate">{label}</span>
        {!allSelected ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange([]);
              }
            }}
            className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-emerald-500/25 cursor-pointer"
            title="Clear site filter"
          >
            <X size={11} />
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-outside catcher */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-30 card-2 shadow-2xl min-w-[260px] max-w-[320px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted]">
                Sites
              </div>
              {!allSelected ? (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[10px] text-[--color-text-dim] hover:text-[--color-text] transition"
                >
                  Clear ({value.length})
                </button>
              ) : null}
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search"
              className="input w-full mb-2"
              autoFocus
            />
            <div className="max-h-[260px] overflow-y-auto -mx-1">
              {sitesQ.isLoading ? (
                <div className="px-3 py-2 text-xs text-[--color-text-muted]">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[--color-text-muted]">
                  {allSites.length === 0 ? 'No site data yet — refresh GAM after deploy.' : 'No matches'}
                </div>
              ) : (
                filtered.map((s) => {
                  const checked = selectedSet.has(s);
                  return (
                    <label
                      key={s}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-xs',
                        'hover:bg-[--color-surface-2]/60',
                        checked && 'text-[--color-text]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(s)}
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      <span className="truncate" title={s}>
                        {s}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
