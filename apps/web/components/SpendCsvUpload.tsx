'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

type UploadResult =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'success'; filename: string; total: number; inserted: number; skipped: number }
  | { kind: 'error'; message: string };

/**
 * PRD §9.3.7 — CSV upload of spend data. Expects a CSV with header row:
 *   date,campaign,source,spend[,clicks,impressions]
 * Sibling component to <SpendForm/> (manual single-row entry).
 */
export function SpendCsvUpload() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<UploadResult>({ kind: 'idle' });

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setResult({ kind: 'error', message: 'File must be a .csv' });
      return;
    }
    setResult({ kind: 'uploading', filename: file.name });
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${BASE}/api/spend/upload-csv`, { method: 'POST', body: fd, credentials: 'include' });
      const body = await res.json();
      if (!body.ok) {
        setResult({ kind: 'error', message: `${body.error?.code}: ${body.error?.message}` });
        return;
      }
      setResult({
        kind: 'success',
        filename: body.data.filename,
        total: body.data.total,
        inserted: body.data.inserted,
        skipped: body.data.skipped,
      });
      void qc.invalidateQueries();
    } catch (e) {
      setResult({ kind: 'error', message: (e as Error).message });
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void upload(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  return (
    <div className="card">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted] mb-2">
        CSV Upload <span className="text-[--color-text-dim] normal-case font-normal">· ad spend (date, campaign, source, spend)</span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 cursor-pointer transition',
          drag
            ? 'border-[--color-accent-revenue] bg-[--color-accent-revenue]/5'
            : 'border-[--color-border] hover:border-[--color-border-strong] hover:bg-[--color-surface-2]/30',
        )}
      >
        <FileUp size={18} className="text-[--color-text-dim]" />
        <div className="text-sm text-[--color-text-dim]">
          Drag &amp; drop CSV, or click to pick
        </div>
        <div className="text-[11px] text-[--color-text-muted]">
          Columns: date, campaign, source, spend (optional: clicks, impressions)
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onPick}
        />
      </div>
      {result.kind === 'uploading' ? (
        <div className="mt-2 text-xs text-[--color-text-dim]">Uploading {result.filename}…</div>
      ) : null}
      {result.kind === 'success' ? (
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-[--color-success]">
          <CheckCircle2 size={12} />
          {result.filename} — {result.inserted} rows upserted, {result.skipped} skipped
        </div>
      ) : null}
      {result.kind === 'error' ? (
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-[--color-danger]">
          <XCircle size={12} />
          {result.message}
        </div>
      ) : null}
    </div>
  );
}
