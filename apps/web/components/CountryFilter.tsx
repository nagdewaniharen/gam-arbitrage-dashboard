'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export function CountryFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (_countries: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const countriesQ = useQuery({
    queryKey: ['countries'],
    queryFn: () => api.countries(),
    staleTime: 5 * 60 * 1000,
  });
  const allCountries = countriesQ.data?.countries ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter((c) => c.toLowerCase().includes(q));
  }, [allCountries, search]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSelected = value.length === 0;
  const label = allSelected
    ? 'All countries'
    : value.length === 1
      ? value[0]
      : `${value.length} countries`;

  function toggle(country: string) {
    if (selectedSet.has(country)) {
      onChange(value.filter((c) => c !== country));
    } else {
      onChange([...value, country]);
    }
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedSet.has(c));
  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const removeSet = new Set(filtered);
      onChange(value.filter((c) => !removeSet.has(c)));
    } else {
      const merged = new Set([...value, ...filtered]);
      onChange(Array.from(merged));
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
        title={allSelected ? 'Filter by country' : value.join(', ')}
      >
        <Flag size={12} />
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
            title="Clear country filter"
          >
            <X size={11} />
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-30 card-2 shadow-2xl min-w-[260px] max-w-[320px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-text-muted]">
                Countries
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
              {countriesQ.isLoading ? (
                <div className="px-3 py-2 text-xs text-[--color-text-muted]">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[--color-text-muted]">
                  {allCountries.length === 0
                    ? 'No country data yet — refresh GAM after deploy.'
                    : 'No matches'}
                </div>
              ) : (
                <>
                  <label
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-xs font-medium',
                      'hover:bg-[--color-surface-2]/60 border-b border-[--color-border] mb-1',
                      'text-[--color-text]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    <span>
                      Select all{search ? ` matching (${filtered.length})` : ` (${filtered.length})`}
                    </span>
                  </label>
                  {filtered.map((c) => {
                    const checked = selectedSet.has(c);
                    return (
                      <label
                        key={c}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-xs',
                          'hover:bg-[--color-surface-2]/60',
                          checked && 'text-[--color-text]',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(c)}
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <span className="truncate" title={c}>
                          {c}
                        </span>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
