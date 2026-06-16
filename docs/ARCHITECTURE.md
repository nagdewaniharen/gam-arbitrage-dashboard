# Architecture — GAM Arbitrage Reporting Dashboard

> Companion to [`PRD.md`](./PRD.md). This document describes **how** we build it, not **what** we build.

## 1. High-level diagram

```
                ┌─────────────────────────────────────────┐
                │  Google Ad Manager / AdX Reporting API  │
                └────────────────────┬────────────────────┘
                                     │ OAuth2 (service account JSON)
                                     │ ReportJob → poll → CSV
                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│  apps/api  (Fastify + TS, container on AWS App Runner)           │
│  - REST endpoints:  /api/{stats,breakdown,trend,cross,...}       │
│  - Internal cron:   /internal/cron/refresh   (HMAC-signed)       │
│  - CSV upload:      /api/upload-csv                              │
│  - Prisma → RDS PostgreSQL                                       │
│  - Secrets read from AWS Secrets Manager at boot                 │
└────────────────────┬─────────────────────────┬───────────────────┘
                     │                         │
                     ▼                         ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │  Amazon RDS Postgres │    │   Amazon S3 bucket   │
        │  - gam_reports       │    │  - raw CSV exports   │
        │  - ad_spend          │    │  - versioning ON     │
        │  - users, audit_log  │    │  - retain forever    │
        │  - cron_runs         │    └──────────────────────┘
        │  - alert_rules/events│
        └──────────────────────┘

                     ▲
                     │ HTTPS (CORS allowlist)
                     │
┌──────────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15, SSR on AWS Amplify)                      │
│  - Server Components for layout, Client Components for charts    │
│  - TanStack Query (5-min refetch interval)                       │
│  - shadcn/ui + Tailwind v4 dark theme                            │
│  - Recharts                                                      │
└──────────────────────────────────────────────────────────────────┘

           ┌─────────────────────────────────────┐
           │ AWS EventBridge Scheduler           │
           │ - cron: every hour on the hour      │
           │ - POST → /internal/cron/refresh     │
           └─────────────────────────────────────┘
```

## 2. Repository layout

```
.
├── apps/
│   ├── api/               Fastify backend
│   │   ├── src/
│   │   │   ├── config/    env validation (zod)
│   │   │   ├── lib/       period helpers, response wrappers, dimension utils
│   │   │   ├── routes/    one file per endpoint
│   │   │   ├── plugins/   (future) auth, logging, metrics
│   │   │   ├── services/  (future) GAM client, MGID client, Slack notifier
│   │   │   └── server.ts  bootstrap
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/               Next.js dashboard
│       ├── app/           App Router pages, layout, providers
│       ├── components/    UI components (KpiCard, TrendChart, …)
│       ├── lib/           api client, formatting helpers
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── db/                Prisma schema + client + migrations + seed
│   └── types/             Shared TS types between api and web
├── infra/
│   └── docker/postgres/   init.sql for local-dev Postgres extensions
├── docs/                  PRD, ARCH, DECISIONS, runbooks
├── .github/workflows/     CI (lint/typecheck/build/docker) + Deploy (OIDC)
├── docker-compose.yml     local dev: postgres (+ api, web in `--profile full`)
├── package.json           pnpm workspace root + Turbo scripts
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## 3. Data flow

### 3.1 Hourly GAM pull

1. **EventBridge Scheduler** fires every hour on the hour (cron `0 * * * ? *`).
2. EventBridge sends a `POST https://api.<domain>/internal/cron/refresh` with an `X-Cron-Signature` header containing HMAC-SHA256 of the body using `INTERNAL_CRON_SECRET`.
3. Fastify route verifies the HMAC; if invalid → 401.
4. Route records a `CronRun` row with status `running`.
5. GAM service (Phase 2A) constructs a `ReportJob` using the dimensions/metrics in PRD §9.3.
6. Job is submitted; status polled with exponential backoff until `COMPLETED`.
7. Resulting CSV is downloaded.
8. **Raw CSV is also written to S3** (`s3://<bucket>/gam-raw/<YYYYMMDDTHHMMSS>.csv`) for replayability.
9. CSV is parsed; rows are upserted into `gam_reports` via Prisma `createMany` chunked to 500 at a time.
10. `CronRun` row is updated with `succeeded`, `rowsAffected`.

### 3.2 Read paths

All read endpoints hit Postgres directly via Prisma raw SQL (typed). Aggregations are computed at the DB layer (`SUM`, `GROUP BY`, derived `ecpm = SUM(revenue) / SUM(impressions) * 1000`). No caching layer in Phase 1; if p95 latency exceeds 500ms, we add Redis later.

### 3.3 CSV upload

`POST /api/upload-csv` (multipart). The same parser used for GAM-fetched CSVs runs. Useful before Phase 2A is live and as a manual override.

## 4. Database design notes

- **Single source of truth**: `packages/db/prisma/schema.prisma`. SQL in PRD §8 is documentary.
- **Upserts everywhere**: `gam_reports` has a 9-column unique key. Every cron and CSV upload is idempotent.
- **`network_id` reserved**: today's data is single-tenant (`23340025403`), but every row carries it. Multi-tenant in the future requires no schema migration — only auth scope changes.
- **Decimals**: `revenue` uses `Decimal(14,4)` to avoid float drift. App-layer `Number(...)` conversion is safe only because we cap at $1B per row.
- **`fetched_at`**: every upsert refreshes this timestamp so we can identify rows refreshed in the last cron pull.

## 5. Authentication

- **Phase 1**: no app-level auth. Edge-level HTTP Basic Auth via Amplify rewrite + custom header for both web and API.
- **Phase 2**: NextAuth (Auth.js v5) with Google OAuth, domain-restricted to the configured Workspace domain. Sessions are JWT, 7 days, stored in HTTP-only cookies. Roles in DB: `admin` | `user`. Bootstrap admin email seeded from `BOOTSTRAP_ADMIN_EMAIL` env. After first login, admins manage roles in-app.

## 6. AWS production topology

| AWS service | What it runs | Notes |
| --- | --- | --- |
| Amplify Hosting | `apps/web` (Next.js 15 SSR) | Branch → `main` auto-deploys. Build from monorepo with `pnpm --filter @gam/web build`. |
| App Runner | `apps/api` (container) | ECR image source. Reads secrets via App Runner → Secrets Manager binding. |
| ECR | API container registry | Private. Tags: `latest`, `<sha>`. |
| RDS Postgres 16 | DB | t4g.small (start). Automated backups 35d + PITR. Daily snapshot copy to a 2nd region. |
| Secrets Manager | secrets | Prefix `gam-arbitrage/`. Rotation manual today; auto-rotation for DB creds later. |
| S3 | raw GAM CSVs, CSV uploads | Versioning ON. Bucket policy: deny public; allow App Runner role. |
| EventBridge Scheduler | hourly cron + (Phase 3) daily MGID, (Phase 4) periodic alerts | Targets: HTTPS to App Runner. |
| Route 53 + ACM | DNS + TLS | App Runner gets a custom domain (e.g., `api.<domain>`); Amplify gets `app.<domain>`. |
| CloudWatch | logs + metrics | 30-day log retention. |

### 6.1 Networking

- Phase 1: RDS is in a public subnet with a security group that only allows the App Runner egress IP (App Runner VPC connector recommended once live).
- Phase 2: App Runner → VPC Connector → RDS in private subnet.

### 6.2 Secrets layout

```
gam-arbitrage/
├── gcp-service-account      ← TL-provided JSON for GAM API
├── database/url             ← Postgres URL (managed by RDS rotation later)
├── internal-cron-secret     ← HMAC key for EventBridge → API
├── mgid-api-key             ← Phase 3
├── nextauth-secret          ← Phase 2C
├── google-oauth/client-id   ← Phase 2C
├── google-oauth/client-secret
└── slack/webhook-url        ← Phase 4
```

## 7. Local development

| Concern | How |
| --- | --- |
| Database | `docker compose up postgres` |
| API | `pnpm --filter @gam/api dev` (tsx watch on src/server.ts) |
| Web | `pnpm --filter @gam/web dev` (Next.js dev server) |
| Both at once | `pnpm dev` (Turbo runs api + web concurrently) |
| Reset + seed | `pnpm db:migrate:reset && pnpm db:seed` |
| Inspect DB | `pnpm db:studio` |
| Swagger | `http://localhost:4000/docs` |

## 8. CI / CD

- **CI** (`.github/workflows/ci.yml`): on every PR — lint, typecheck, build, docker-build (no push).
- **Deploy** (`.github/workflows/deploy.yml`): on push to `main` — build & push API image to ECR via OIDC role; trigger App Runner deployment; trigger Amplify build.
- **No long-lived AWS keys**: GitHub OIDC federation. Required GitHub secrets:
  - `AWS_DEPLOY_ROLE_ARN`
  - `APP_RUNNER_API_ARN`
  - `AMPLIFY_APP_ID`

## 9. Observability

- **Logs**: Pino structured JSON → stdout → CloudWatch.
- **Health**: `/api/health` (liveness + DB ping); App Runner uses it.
- **Status**: `/api/status` (consumer-facing — surfaces last successful cron, total rows, DB state).
- **Cron alarms**: CloudWatch alarm on `lastSuccessfulCronAt > 3h ago` → SNS → Slack (Phase 4).
- **Errors**: Sentry (Phase 4).

## 10. Backup & disaster recovery

- **RPO**: ≤ 5 minutes (RDS PITR).
- **RDS**:
  - Automated backups, 35-day retention (RDS maximum).
  - Daily snapshot copy to a second AWS region.
- **S3 (raw CSVs)**: versioning ON, retain forever; survives accidental delete and gives a replay path if `gam_reports` is ever corrupted.
- **Restore drill**: documented in [`DEPLOYMENT.md`](./DEPLOYMENT.md) (created during Phase 0 deploy).

## 11. Performance budget (Phase 1)

- p95 API response time: < 250 ms (single-region, < 1M rows).
- p95 page load: < 2 s.
- DB query plan: every read uses `(date)` index or `(date, <dim>)` composite index. Re-evaluate at 5M rows.

## 12. Security baseline

- HTTPS only (ACM).
- `helmet` middleware (CSP off in Phase 1; enable in Phase 2 once SSO is in).
- `cors` allowlist limited to `WEB_ORIGIN`.
- Rate limit on `/api/*` (100 req/min/IP).
- Multipart file size cap (50 MB).
- Secret values never logged, never returned in API responses.
- `.gitignore` covers all known secret-file patterns.

## 13. Decision log

See [`DECISIONS.md`](./DECISIONS.md).
