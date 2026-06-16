'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ShieldAlert } from 'lucide-react';

function ForbiddenInner() {
  const sp = useSearchParams();
  const reason = sp.get('reason');
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center flex flex-col gap-3 items-center">
        <ShieldAlert size={28} className="text-[--color-warning]" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-[--color-text-dim]">
          {reason === 'domain'
            ? 'Your Google account is not on the allowed Workspace domain. Ask your admin to grant access.'
            : 'You do not have permission to view this dashboard.'}
        </p>
      </div>
    </main>
  );
}

export default function ForbiddenPage() {
  return (
    <Suspense fallback={null}>
      <ForbiddenInner />
    </Suspense>
  );
}
