import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
// Load repo-root .env first, then allow apps/api/.env to override.
loadEnv({ path: resolve(here, '../../../../.env') });
loadEnv({ path: resolve(here, '../../.env'), override: true });

// Treat empty-string env values as unset so optional URL/email fields validate.
for (const k of Object.keys(process.env)) {
  if (process.env[k] === '') delete process.env[k];
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),

  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  INTERNAL_CRON_SECRET: z.string().min(16).default('dev_only_change_me_to_a_long_string'),

  GAM_NETWORK_CODE: z.string().default('23340025403'),
  GAM_SERVICE_ACCOUNT_JSON_PATH: z.string().optional(),
  GAM_REPORT_TIMEZONE: z.string().default('Asia/Kolkata'),
  GAM_BACKFILL_DAYS_ON_FIRST_RUN: z.coerce.number().int().positive().default(90),
  GAM_INCREMENTAL_DAYS_PER_RUN: z.coerce.number().int().positive().default(7),

  MGID_API_KEY: z.string().optional(),
  MGID_API_BASE_URL: z.string().url().default('https://api.mgid.com/v1'),

  SLACK_WEBHOOK_URL: z.string().url().optional(),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_RAW_REPORTS_BUCKET: z.string().optional(),
  AWS_SECRETS_PREFIX: z.string().default('gam-arbitrage'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
