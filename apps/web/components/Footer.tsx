import { Database, Clock, Layers } from 'lucide-react';
import type { StatusResponse } from '@gam/types';
import { fmt } from '@/lib/format';
import { formatIST, relativeTime } from '@/lib/time';

export function Footer({ status }: { status: StatusResponse | undefined }) {
  return (
    <footer className="mt-8 grid gap-3 text-xs text-[--color-text-dim] md:grid-cols-3">
      <div className="inline-flex items-center gap-2">
        <Database size={12} className="text-[--color-text-muted]" />
        <span className="text-[--color-text-muted]">Database</span>
        <span className={status?.databaseUp ? 'text-[--color-success]' : 'text-[--color-danger]'}>
          {status?.databaseUp ? '● connected' : '● offline'}
        </span>
      </div>
      <div className="inline-flex items-center gap-2">
        <Clock size={12} className="text-[--color-text-muted]" />
        <span className="text-[--color-text-muted]">Last sync</span>
        <span className="text-[--color-text]">
          {status?.lastSuccessfulCronAt
            ? `${formatIST(status.lastSuccessfulCronAt)} IST`
            : '—'}
        </span>
        {status?.lastSuccessfulCronAt ? (
          <span className="text-[--color-text-muted]">
            ({relativeTime(status.lastSuccessfulCronAt)})
          </span>
        ) : null}
      </div>
      <div className="inline-flex items-center gap-2 md:justify-end">
        <Layers size={12} className="text-[--color-text-muted]" />
        <span className="text-[--color-text-muted]">Rows</span>
        <span className="text-[--color-text] font-mono-num">
          {status ? fmt.num(status.totalRows) : '—'}
        </span>
      </div>
    </footer>
  );
}
