import { Database, Upload, Link2 } from 'lucide-react';

/**
 * Shown when the dashboard has no GAM data yet (first-run experience).
 * Guides the user toward two onboarding paths: live GAM API or CSV upload.
 */
export function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-4 py-10 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[--color-border] bg-[--color-surface-2] text-[--color-text-dim]">
        <Database size={20} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[--color-text]">No data yet</h2>
        <p className="text-sm text-[--color-text-dim] mt-1 max-w-md">
          Once GAM reporting is connected (or you upload a CSV export), revenue, impressions,
          breakdowns and trends will appear here automatically.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 w-full max-w-md mt-2">
        <div className="card-2 text-left">
          <div className="inline-flex items-center gap-2 text-xs font-medium mb-1">
            <Link2 size={12} className="text-[--color-accent-revenue]" />
            Connect GAM API
          </div>
          <p className="text-xs text-[--color-text-dim]">
            Add the service account email inside GAM Admin → Users with Reporting role, then click
            Refresh in the header.
          </p>
        </div>
        <div className="card-2 text-left">
          <div className="inline-flex items-center gap-2 text-xs font-medium mb-1">
            <Upload size={12} className="text-[--color-accent-impressions]" />
            Upload a CSV
          </div>
          <p className="text-xs text-[--color-text-dim]">
            Export any GAM report as CSV and drop it into the CSV upload card below. Same parser
            as the live API path.
          </p>
        </div>
      </div>
    </div>
  );
}
