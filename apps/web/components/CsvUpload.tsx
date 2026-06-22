'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

type UploadResult =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'success'; filename: string; total: number; inserted: number; errorCount: number }
  | { kind: 'error'; message: string };

export function CsvUpload() {
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
      const res = await fetch(`${BASE}/api/upload-csv`, { method: 'POST', body: fd });
      const body = await res.json();
      if (!body.ok) {
        setResult({ kind: 'error', message: `${body.error?.code}: ${body.error?.message}` });
        return;
      }
      setResult({
        kind: 'success',
        filename: body.data.filename,
        total: body.data.totalRows,
        inserted: body.data.inserted,
        errorCount: body.data.errorSamples?.length ?? 0,
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
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  return (
    <div className="card">
      <div className="flex items-baseline gap-2 mb-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[--color-text-muted]">
          CSV Upload
        </div>
        <span className="text-[10px] text-[--color-text-muted]">GAM report export</span>
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
          'cursor-pointer rounded-lg border border-dashed px-5 py-6 text-center transition',
          drag
            ? 'border-[--color-accent-revenue] bg-[--color-accent-revenue]/[0.04]'
            : 'border-[--color-border] hover:border-[--color-border-strong] hover:bg-[--color-surface-2]/40',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPick}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[--color-border] bg-[--color-surface-2] text-[--color-text-dim]">
            <FileUp size={16} />
          </div>
          <div className="text-sm text-[--color-text]">
            {result.kind === 'uploading'
              ? `Uploading ${result.filename}…`
              : 'Drag & drop CSV, or click to pick'}
          </div>
          <div className="text-[11px] text-[--color-text-muted] max-w-md">
            Columns: date, ad_unit, campaign, source, headline, lander, image, page, impressions,
            clicks, revenue, ecpm
          </div>
        </div>
      </div>
      {result.kind === 'success' ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-[--color-success]/20 bg-[--color-success]/[0.06] px-3 py-1.5 text-xs">
          <CheckCircle2 size={14} className="text-[--color-success]" />
          <span>
            <span className="text-[--color-text]">{result.filename}</span>
            <span className="text-[--color-text-muted]"> · </span>
            <span className="text-[--color-success] font-mono-num">{result.inserted}</span>
            <span className="text-[--color-text-muted]"> of {result.total} rows inserted</span>
            {result.errorCount > 0 ? (
              <>
                <span className="text-[--color-text-muted]"> · </span>
                <span className="text-[--color-warning]">{result.errorCount} skipped</span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {result.kind === 'error' ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-[--color-danger]/20 bg-[--color-danger]/[0.06] px-3 py-1.5 text-xs text-[--color-danger]">
          <XCircle size={14} />
          {result.message}
        </div>
      ) : null}
    </div>
  );
}
