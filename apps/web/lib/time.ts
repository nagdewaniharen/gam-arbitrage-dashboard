export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 0) return 'in the future';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function freshnessTier(iso: string | null | undefined): 'fresh' | 'stale' | 'failed' {
  if (!iso) return 'failed';
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs > 3 * 60 * 60 * 1000) return 'failed';
  if (ageMs > 90 * 60 * 1000) return 'stale';
  return 'fresh';
}

export function formatIST(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
