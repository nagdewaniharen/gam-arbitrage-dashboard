/**
 * S3 raw-CSV archive.
 *
 * Per ARCHITECTURE.md §15, every GAM CSV we pull is also written to S3 with a
 * timestamped key, so the entire history is replayable if `gam_reports` is
 * ever corrupted.
 *
 * No-op when AWS_S3_RAW_REPORTS_BUCKET is not set (local dev / Phase 1).
 *
 * We use the AWS SDK's S3 client lazily (only imported when actually called)
 * so projects without S3 don't pay the bundle cost.
 */
import { env } from '../config/env.js';

interface Logger {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

export async function archiveRawCsv(
  csv: string,
  meta: { source: 'gam' | 'mgid' | 'csv-upload'; from?: string; to?: string },
  log: Logger,
): Promise<{ archived: boolean; key?: string; reason?: string }> {
  if (!env.AWS_S3_RAW_REPORTS_BUCKET) {
    return { archived: false, reason: 'AWS_S3_RAW_REPORTS_BUCKET not set' };
  }
  try {
    // Lazy import — only paid for when actually needed.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: env.AWS_REGION });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${meta.source}/${ts}.csv`;
    await client.send(
      new PutObjectCommand({
        Bucket: env.AWS_S3_RAW_REPORTS_BUCKET,
        Key: key,
        Body: csv,
        ContentType: 'text/csv',
        Metadata: {
          source: meta.source,
          ...(meta.from ? { from: meta.from } : {}),
          ...(meta.to ? { to: meta.to } : {}),
        },
      }),
    );
    log.info(`S3: archived ${csv.length} bytes to s3://${env.AWS_S3_RAW_REPORTS_BUCKET}/${key}`);
    return { archived: true, key };
  } catch (e) {
    log.warn('S3 archive failed (non-fatal)', e);
    return { archived: false, reason: (e as Error).message };
  }
}
