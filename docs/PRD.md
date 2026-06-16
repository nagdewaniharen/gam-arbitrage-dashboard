# PRD — GAM Arbitrage Reporting Dashboard

| Field | Value |
| --- | --- |
| Document version | 1.0.0 |
| Status | **Approved — in build** |
| Last updated | 2026-06-15 |
| Original author | Heren Nagdewani |
| Build owner | Engineering |
| Audience | Internal engineering, outsourced contractors, QA, ops |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [Non-Goals](#4-non-goals)
5. [Personas & User Stories](#5-personas--user-stories)
6. [System Architecture (high level)](#6-system-architecture-high-level)
7. [Data Sources](#7-data-sources)
8. [Database Schema](#8-database-schema)
9. [GAM API Integration](#9-gam-api-integration)
10. [Dashboard Features & UI](#10-dashboard-features--ui)
11. [API Contract](#11-api-contract)
12. [Authentication, Authorization & Security](#12-authentication-authorization--security)
13. [Technical Stack — Locked](#13-technical-stack--locked)
14. [Deployment & Infrastructure (AWS)](#14-deployment--infrastructure-aws)
15. [Observability, Backups & Data Durability](#15-observability-backups--data-durability)
16. [Milestones & Timeline](#16-milestones--timeline)
17. [Acceptance Criteria](#17-acceptance-criteria)
18. [Definition of Done](#18-definition-of-done)
19. [Open Items / Pending External Inputs](#19-open-items--pending-external-inputs)
20. [Appendix A — GAM Key-Values Setup](#appendix-a--gam-key-values-setup)
21. [Appendix B — Traffic URL Format](#appendix-b--traffic-url-format)
22. [Appendix C — Change Log](#appendix-c--change-log)

---

## 1. Executive Summary

We operate an ad arbitrage business: we buy traffic from sources such as **MGID, Meta, Google Ads, and ShareChat** and monetize that traffic through **Google Ad Manager (GAM) + Ad Exchange (AdX)**.

We need a real-time reporting dashboard that surfaces **revenue, impressions, eCPM, and performance breakdowns** across the dimensions that actually matter to our media buyers: **campaign, traffic source, headline, landing page, ad image, and ad unit**. The goal is to quickly **identify profitable campaigns and kill unprofitable ones**.

The dashboard pulls data directly from the **Google Ad Manager Reporting API** on an hourly cadence, persists it in our own database, and serves it through a fast, dark-themed web UI.

## 2. Problem Statement

GAM's built-in reporting is:

- **Slow and clunky** — every report takes minutes to generate.
- **Cannot show real-time revenue** broken down by our custom dimensions (campaign, source, headline).
- **No way to quickly compare** campaign performance across different traffic sources.
- **No unified view** of revenue vs. cost (ROI) per campaign.
- **Reports require manual CSV exports** and spreadsheet analysis to be actionable.

This costs the media-buying team hours every day, and worse, **bad campaigns keep spending money until someone notices**.

## 3. Goals & Success Metrics

### Goals

- Automated **hourly** data pull from GAM API.
- **Sub-second** dashboard load time after initial bootstrap.
- Revenue breakdown by **any combination of 7 dimensions** (campaign × source × headline × lander × image × ad_unit × page).
- Identify top/bottom performing campaigns in **under 5 seconds**.
- Historical trend analysis (daily, weekly, monthly).
- Production-grade reliability so the dashboard can be a primary decision tool.

### Success Metrics

| Metric | Target |
| --- | --- |
| Dashboard p95 load time | < 2 seconds |
| Data freshness lag | < 2 hours (hourly sync + buffer) |
| Time to identify underperforming campaign | < 10 seconds |
| Uptime | 99.5% monthly |
| GAM API job failure rate | < 1% rolling 7-day |
| Data durability (acceptable RPO) | 5 minutes (RDS PITR) |

## 4. Non-Goals

Explicitly **out of scope** for v1:

- Multi-publisher-network support (architecture leaves a `network_id` column reserved; activation is a config flip).
- Forecasting / ML-based campaign scoring.
- Direct campaign-action controls (pause/resume in MGID, etc.).
- Public/customer-facing reporting.
- Mobile-native apps (responsive web is sufficient).
- Real-time websocket streaming (5-minute auto-refresh is enough).

## 5. Personas & User Stories

### Personas

| Persona | Description | Tool needs |
| --- | --- | --- |
| **Media Buyer** | Day-to-day operator running paid campaigns on MGID/Meta/Google/ShareChat. Wants to find winners and kill losers fast. | All read views, period switching, top/bottom performers, alerts. |
| **Admin** | Team lead / business owner. Needs everything the buyer has, plus user management, manual data refresh, spend input, and configuration. | All views + admin pages. |

### User Stories (from original PRD, normalized)

| ID | Priority | As a… | I want to… | So that… |
| --- | --- | --- | --- | --- |
| US-1 | P0 | Media buyer | See total revenue, impressions, eCPM for today / 7d / 30d | I know how much I'm earning |
| US-2 | P0 | Media buyer | Break down revenue by campaign | I can identify which campaigns are profitable |
| US-3 | P0 | Media buyer | Break down revenue by traffic source (mgid, meta, sharechat) | I can allocate budget to the best source |
| US-4 | P0 | Media buyer | See revenue by ad unit (rewarded, display, anchor, interstitial) | I can optimize ad placement |
| US-5 | P1 | Media buyer | Cross-reference campaign × source × ad unit | I find the exact winning combination |
| US-6 | P1 | Media buyer | See daily revenue trend chart | I spot patterns and anomalies |
| US-7 | P1 | Media buyer | See top 10 and bottom 10 campaigns by eCPM | I scale winners and kill losers quickly |
| US-8 | P1 | Media buyer | Break down by headline and landing page variant | I optimize creative performance |
| US-9 | P2 | Media buyer | Input ad spend per campaign and see ROI / ROAS | I calculate actual profit |
| US-10 | P2 | Media buyer | Set alerts when eCPM drops below threshold | I am notified of problems immediately |
| US-11 | P2 | Media buyer | Compare date ranges (this week vs last week) | I track growth / decline |
| US-12 | P2 | Admin | Manually refresh data from GAM | I don't have to wait for the hourly cron |

## 6. System Architecture (high level)

```
┌────────────────────┐       ┌──────────────────────┐       ┌─────────────────────┐
│  Google Ad Manager │       │  Backend API         │       │  Dashboard UI       │
│  / AdX Reporting   │ <───  │  (Fastify + TS)      │ <───  │  (Next.js + React)  │
│  API               │       │  on AWS App Runner   │       │  on AWS Amplify     │
└────────────────────┘       └─────────┬────────────┘       └─────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                  ┌───────▼────────┐       ┌────────▼──────────┐
                  │  Amazon RDS    │       │  AWS Secrets Mgr  │
                  │  (PostgreSQL)  │       │  (GAM JSON, DB,   │
                  │  hourly history│       │   MGID key,       │
                  │                │       │   Slack webhook)  │
                  └────────────────┘       └───────────────────┘

                  ┌───────────────────────┐
                  │ EventBridge Scheduler │  ─── hourly POST → /internal/cron/refresh
                  └───────────────────────┘
```

- **Hourly cron**: AWS EventBridge Scheduler invokes a signed HTTPS request to the API's internal cron endpoint.
- **GAM client**: API server uses the official Google client library, authenticated via service account JSON pulled from Secrets Manager at boot.
- **CSV upload fallback**: Until the GAM service account is provisioned, the API accepts CSV exports from the GAM dashboard via `POST /api/upload-csv`. Same parser; same database table.

Full architectural detail in [ARCHITECTURE.md](./ARCHITECTURE.md).

## 7. Data Sources

### 7.1 Google Ad Manager Reporting API

| Concept | GAM dimension / metric | Notes |
| --- | --- | --- |
| Date | `DATE` | Report date, IST timezone |
| Ad unit | `AD_UNIT_NAME` | site_top, site_anchor, site_rewarded, site_interstitial, site_in_content |
| Campaign | `CUSTOM_TARGETING_VALUE_ID` (key: `campaign`) | Campaign identifier from URL params |
| Source | `CUSTOM_TARGETING_VALUE_ID` (key: `source`) | Traffic source (mgid, meta, sharechat, google) |
| Headline | `CUSTOM_TARGETING_VALUE_ID` (key: `headline`) | Ad headline variant |
| Lander | `CUSTOM_TARGETING_VALUE_ID` (key: `lander`) | Landing-page variant |
| Image | `CUSTOM_TARGETING_VALUE_ID` (key: `image`) | Ad image variant |
| Impressions | `AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS` | |
| Clicks | `AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS` | |
| Revenue | `AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE` | USD |
| eCPM | `AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM` | Effective CPM |

### 7.2 GAM Key-Values (already configured)

| Key | Type | Description | Reportable | Set via |
| --- | --- | --- | --- | --- |
| `campaign` | Dynamic (freeform) | Campaign identifier (e.g., `camp_india_01`) | Yes | `googletag.pubads().setTargeting('campaign', value)` |
| `source` | Dynamic (freeform) | Traffic source (`mgid`, `meta`, `sharechat`, `google`) | Yes | Same |
| `headline` | Dynamic (freeform) | Ad headline variant | Yes | Same |
| `lander` | Dynamic (freeform) | Landing page variant | Yes | Same |
| `image` | Dynamic (freeform) | Ad image variant | Yes | Same |

Targeting model:
1. User clicks a paid ad → URL contains `?campaign=…&source=…&headline=…&lander=…&image=…`.
2. Funnel JS extracts URL params, persists to `sessionStorage` under `jp_*` keys.
3. On every ad request, JS reads those values and pushes them to GAM via `googletag.pubads().setTargeting(...)`.
4. GAM tags every impression with those targeting values.
5. GAM Reporting API returns them in our reports.

### 7.3 GAM Account Details

| Field | Value |
| --- | --- |
| GAM Network Code | `23340025403` |
| Publisher Network | River Five Global |
| Ad Units | `site_top`, `site_anchor`, `site_rewarded`, `site_interstitial`, `site_in_content` |
| Authentication | OAuth 2.0 — service account (server-to-server) |

### 7.4 MGID Spend (Phase 3)

- Source: MGID Partner API (`https://api.mgid.com/v1/...`)
- Required credential: MGID Partner API key (to be provisioned by TL)
- Fields pulled: date, campaign ID, spend (USD), clicks, impressions
- Cadence: daily (24h after each campaign day closes)

## 8. Database Schema

PostgreSQL 16, managed via Prisma migrations. The canonical definition lives in [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma); the SQL view here is illustrative.

### `gam_reports` — every (date × dimension-combo) row from GAM

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial PK` | |
| `network_id` | `text NOT NULL DEFAULT '23340025403'` | **Reserved for multi-tenant**; single value today |
| `date` | `date NOT NULL` | Report date (IST) |
| `campaign` | `text NOT NULL DEFAULT ''` | |
| `source` | `text NOT NULL DEFAULT ''` | |
| `headline` | `text NOT NULL DEFAULT ''` | |
| `lander` | `text NOT NULL DEFAULT ''` | |
| `image` | `text NOT NULL DEFAULT ''` | |
| `ad_unit` | `text NOT NULL DEFAULT ''` | |
| `page` | `text NOT NULL DEFAULT ''` | |
| `impressions` | `bigint NOT NULL DEFAULT 0` | |
| `clicks` | `bigint NOT NULL DEFAULT 0` | |
| `revenue` | `numeric(14,4) NOT NULL DEFAULT 0` | USD |
| `ecpm` | `numeric(10,4) NOT NULL DEFAULT 0` | |
| `viewability` | `numeric(5,4) NOT NULL DEFAULT 0` | 0.0–1.0 |
| `match_rate` | `numeric(5,4) NOT NULL DEFAULT 0` | 0.0–1.0 |
| `fetched_at` | `timestamptz NOT NULL DEFAULT now()` | Last upsert timestamp |
| **UNIQUE** | `(network_id, date, campaign, source, headline, lander, image, ad_unit, page)` | Upsert key |

Indexes: `(date)`, `(date, campaign)`, `(date, source)`, `(date, ad_unit)`, `(network_id, date)`.

### `ad_spend` — manual / CSV / MGID-API spend per (date × campaign × source)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial PK` | |
| `network_id` | `text NOT NULL` | |
| `date` | `date NOT NULL` | |
| `campaign` | `text NOT NULL DEFAULT ''` | |
| `source` | `text NOT NULL DEFAULT ''` | |
| `spend` | `numeric(14,4) NOT NULL DEFAULT 0` | USD |
| `clicks` | `bigint NOT NULL DEFAULT 0` | |
| `impressions` | `bigint NOT NULL DEFAULT 0` | |
| `entered_by` | `text NOT NULL` | `'manual:<user-email>'` \| `'csv'` \| `'mgid-api'` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |
| **UNIQUE** | `(network_id, date, campaign, source)` | |

### `users` — dashboard accounts (Phase 2)

| Column | Type |
| --- | --- |
| `id` | `uuid PK` |
| `email` | `citext UNIQUE NOT NULL` |
| `name` | `text` |
| `role` | `text NOT NULL CHECK (role IN ('admin','user'))` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `last_login_at` | `timestamptz` |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

### `audit_log` — every mutating action

| Column | Type |
| --- | --- |
| `id` | `bigserial PK` |
| `actor_email` | `text NOT NULL` |
| `action` | `text NOT NULL` (e.g., `'spend.create'`, `'cron.refresh'`, `'user.role_change'`) |
| `target` | `text` |
| `metadata` | `jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `alert_rules` (Phase 4) and `alert_events` (Phase 4)

Defined in schema; details deferred to Phase 4 ticket.

## 9. GAM API Integration

### 9.1 Authentication

We use **OAuth 2.0 via a GCP service account** (server-to-server). Specifically:

1. Service account `gam-reporter@<gcp-project>.iam.gserviceaccount.com` lives inside a dedicated GCP project (`gam-arbitrage-prod`).
2. Service account JSON key is stored in **AWS Secrets Manager** at `gam-arbitrage/gcp-service-account`.
3. The service account email is added inside **GAM Admin → Access & Authorization** with the **Reporting** role.
4. The API server reads the JSON at boot, instantiates a Google Auth client, and uses it to call the GAM Reporting API.

Step-by-step provisioning runbook for the GAM admin is in [`docs/RUNBOOK_GAM_SERVICE_ACCOUNT.md`](./RUNBOOK_GAM_SERVICE_ACCOUNT.md).

### 9.2 Report Execution Flow (hourly)

1. **EventBridge Scheduler** fires every hour on the hour.
2. EventBridge invokes `POST /internal/cron/refresh` on App Runner with an HMAC-signed header.
3. The API:
   a. Verifies the HMAC.
   b. Builds a GAM `ReportJob` query (dimensions + metrics + date range).
   c. Submits the job to GAM.
   d. Polls `getReportJobStatus` until status is `COMPLETED` (with timeout & retry).
   e. Downloads the report as CSV.
   f. Parses the CSV.
   g. Upserts each row into `gam_reports` keyed on the unique tuple.
   h. Records the run in `audit_log`.
4. **First run**: 90-day backfill (per locked decision). Subsequent runs: last 7 days each time to catch delayed data.

### 9.3 Report Query

```yaml
dimensions:
  - DATE
  - AD_UNIT_NAME
  - CUSTOM_TARGETING_VALUE_ID  # for keys: campaign, source, headline, lander, image
metrics:
  - AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS
  - AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS
  - AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE
  - AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM
  - AD_EXCHANGE_LINE_ITEM_LEVEL_PERCENT_VIEWABLE_IMPRESSIONS
  - AD_EXCHANGE_LINE_ITEM_LEVEL_REQUESTS
  - AD_EXCHANGE_LINE_ITEM_LEVEL_MATCH_RATE
dateRange:
  default: LAST_7_DAYS         # rolling window each hourly run
  firstRun: LAST_90_DAYS       # one-time backfill
timezone: Asia/Kolkata          # all dates interpreted in IST
```

### 9.4 Rate Limits & Idempotency

- The GAM API has report-job quotas. Hourly + last-7-days is well within them.
- Every row is upserted on the unique tuple — re-running the cron is safe.
- Delayed-arriving impressions (next-day adjustments by Google) are picked up on the next hourly run.

### 9.5 CSV Upload Fallback

While GAM credentials are pending (or for ad-hoc rebuilds), the same parser runs via `POST /api/upload-csv`. Required headers in the CSV are validated; mismatched headers return a 422 with a field-by-field diff.

## 10. Dashboard Features & UI

### 10.1 Design Requirements

- **Theme**: dark mode (deep gray background, light text).
- **Responsive**: works on desktop and mobile (≥ 360px).
- **Fast**: all data via API; no full-page reloads.
- **Auto-refresh**: every 5 minutes (TanStack Query `refetchInterval`).
- **Accessibility**: keyboard navigable, WCAG AA color contrast on accent colors.

### 10.2 Layout (top to bottom)

1. **Top bar**: title + period selector `[Today][7d][30d][All]` + manual refresh button + last-refresh timestamp.
2. **KPI row** (4 cards): Revenue (green), Impressions (blue), Avg eCPM (yellow), Clicks + CTR.
3. **Daily Revenue Trend** (bar chart, Recharts).
4. **Two breakdown tables side by side**: each with its own dimension dropdown.
5. **Top 10 / Bottom 10 performers by eCPM** (with minimum-impression filter).
6. **Cross-dimensional analysis** (Dim1 × Dim2 dropdowns).
7. **Phase 2 zone**: Cost & ROI table.
8. **Footer**: last refresh timestamp + total row count.

### 10.3 Feature Details

| # | Feature | Priority | Notes |
| --- | --- | --- | --- |
| 10.3.1 | KPI Cards | P0 | Revenue (USD, green), Impressions (blue), Avg eCPM (yellow), Clicks + CTR. % change vs previous period is optional in v1. |
| 10.3.2 | Period Selector | P0 | Today / 7d / 30d / All Time. Re-fetches all data on change. Custom range picker = Phase 2. |
| 10.3.3 | Daily Revenue Trend | P1 | Recharts bar chart, hover tooltip showing date / revenue / impressions / eCPM. |
| 10.3.4 | Dimension Breakdown Tables | P0 | Two side-by-side. Each has a dropdown for dimension. Columns: Name / Impressions / Revenue / eCPM / CTR. Sortable, default sort Revenue DESC. |
| 10.3.5 | Top/Bottom 10 by eCPM | P1 | Two columns. Min-impression threshold (>10) to filter noise. |
| 10.3.6 | Cross-dimensional analysis | P1 | Two dropdowns (Dim1, Dim2). Table of every combination with metrics. |
| 10.3.7 | Cost & ROI | P2 | Manual input form (date / campaign / source / spend) or CSV upload. Computed: Profit = Revenue − Spend; ROI% = Profit / Spend × 100; ROAS = Revenue / Spend. |
| 10.3.8 | CSV Upload | P1 | Drag & drop or file picker. Parses GAM-format CSV. Useful before/instead of API integration. |
| 10.3.9 | Manual refresh | P0 | Admin-only button that triggers the same cron flow on-demand. |

## 11. API Contract

All routes prefixed with `/api`. Internal routes prefixed `/internal`. Authentication described in §12.

Full machine-readable spec served at `/docs` (Swagger UI) and `/openapi.json` (the spec itself).

### 11.1 Read endpoints

| Method | Path | Description | Query params |
| --- | --- | --- | --- |
| GET | `/api/stats` | Summary KPIs | `period=today\|7d\|30d\|all` |
| GET | `/api/breakdown/:dimension` | Revenue breakdown by single dimension | `period`, `limit` |
| GET | `/api/trend` | Daily revenue trend | `period` |
| GET | `/api/cross/:dim1/:dim2` | Cross-dimensional analysis | `period`, `limit` |
| GET | `/api/performers/:type` | Top or bottom performers | `period`, `by`, `limit`, `type=top\|bottom` |
| GET | `/api/status` | Last refresh timestamp, total rows, cron health | — |
| GET | `/api/health` | App health (DB connectivity, secrets reachability) | — |

Valid `:dimension` values: `campaign`, `source`, `headline`, `lander`, `image`, `ad_unit`, `page`, `date`.

### 11.2 Mutating endpoints

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| POST | `/api/refresh` | Manually trigger GAM data refresh | admin |
| POST | `/api/upload-csv` | Upload GAM report CSV (`multipart/form-data`) | admin |
| POST | `/api/spend` | Phase 2 — log ad spend (JSON body) | admin |
| POST | `/api/users/:id/role` | Phase 2 — change a user's role | admin |

### 11.3 Internal endpoints (HMAC-protected, not in public OpenAPI)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/internal/cron/refresh` | EventBridge → triggers hourly GAM pull |
| POST | `/internal/cron/mgid` | Phase 3 — daily MGID spend pull |
| POST | `/internal/cron/alerts` | Phase 4 — evaluate alert rules, fire to Slack |

### 11.4 Example calls

```bash
# 7-day summary
GET /api/stats?period=7d

# Revenue by campaign for last 30 days (top 20)
GET /api/breakdown/campaign?period=30d&limit=20

# 30-day daily trend
GET /api/trend?period=30d

# Campaign × Source cross analysis
GET /api/cross/campaign/source?period=7d

# Top 10 campaigns by eCPM, last 7 days
GET /api/performers/top?by=campaign&period=7d&limit=10
```

### 11.5 Response shape (standard)

All success responses follow:
```json
{
  "ok": true,
  "data": { /* endpoint-specific */ },
  "meta": { "generatedAt": "2026-06-15T08:00:00Z", "period": "7d" }
}
```
All error responses follow:
```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }
}
```

## 12. Authentication, Authorization & Security

### 12.1 Phase 1 (Weeks 1–3) — private URL

- No app-level user login.
- App Runner endpoint is **not** publicly discoverable (custom obscure subdomain).
- **HTTP Basic Auth at edge** (Amplify rewrite + custom header) protects both API and Web during dev/staging.
- Internal endpoints (`/internal/*`) require **HMAC signature** verified against a secret in Secrets Manager.

### 12.2 Phase 2 — Google Workspace SSO

- **NextAuth (Auth.js v5)** with **Google OAuth** provider.
- **Domain restriction**: only `@<your-workspace-domain>` emails allowed.
- First login of any allowed-domain user creates a `users` row with role `user` by default.
- Bootstrap admin: a single email is hardcoded in env (`BOOTSTRAP_ADMIN_EMAIL`) and is promoted to `admin` on first login. After that, admins can promote/demote in the UI.
- Sessions: JWT, 7-day expiry, refresh on each request.
- Roles:
  - **admin** — full read + write (CSV upload, manual refresh, spend input, user management).
  - **user** — read-only.

### 12.3 GAM API credentials

- Service account JSON stored only in **AWS Secrets Manager** (`gam-arbitrage/gcp-service-account`).
- Read at server boot, kept in process memory; never logged, never exposed via any API endpoint.
- Refresh tokens never exposed to the frontend.
- Local `.env` files are gitignored; `.env.example` shows variable names only.

### 12.4 Other security baselines

- All HTTP routes served over HTTPS (ACM certs).
- `helmet` middleware on the API (CSP, X-Frame-Options, etc.).
- `cors` allowlist (only the Amplify domain).
- Rate limiting on `/api/*` (100 req/min per IP) via `@fastify/rate-limit`.
- Request validation via Fastify JSON schemas — bad inputs rejected at the edge.
- Input sanitization on CSV upload (size cap 50 MB, type sniffing).
- All admin mutating actions logged to `audit_log`.

## 13. Technical Stack — Locked

| Layer | Tech | Version | Rationale |
| --- | --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | latest | Standard for TS monorepos in 2026 |
| Backend runtime | Node.js | 20 LTS | LTS until 2026-04 |
| Backend framework | Fastify | 5.x | Faster than Express; JSON Schema validation; auto OpenAPI |
| Backend language | TypeScript | 5.x | Type safety, outsource-friendly |
| ORM | Prisma | 5.x | Type-safe queries; migrations; strong DX |
| Database | PostgreSQL | 16 | Production-grade from day 1 (Section 3 above) |
| GAM client | `google-ads-node` / `googleapis` | latest | Official Google library |
| Cron | EventBridge Scheduler → HTTPS | — | No always-on scheduler needed |
| Frontend framework | Next.js | 15 (App Router) | Industry standard React framework |
| UI library | React | 19 | Latest stable |
| Styling | Tailwind CSS | 4 | Standard utility framework |
| Components | shadcn/ui (Radix + Tailwind) | latest | Owned code, no runtime dep |
| Charts | Recharts | latest | React-native; composable |
| Data fetching | TanStack Query | 5 | Caching + auto refetch (5-min interval) |
| Auth (Phase 2) | NextAuth / Auth.js | 5 | Google Workspace OAuth |
| Containerization | Docker + docker-compose | latest | Local dev parity with prod |
| CI/CD | GitHub Actions | — | Lint + typecheck + build on PR; deploy on merge |
| Component docs | Storybook | 8 | UI component catalogue |
| API docs | Swagger UI (`@fastify/swagger`) | latest | Auto-generated from route schemas |
| Linting | ESLint (flat config) + Prettier | latest | |
| Testing (Phase 2+) | Vitest + Supertest + Playwright | latest | Coverage gate not enforced in v1 |

## 14. Deployment & Infrastructure (AWS)

| Component | AWS service |
| --- | --- |
| Web (Next.js) | AWS Amplify Hosting (native Next.js 15 SSR support) |
| API (Fastify, containerized) | AWS App Runner (with ECR image source) |
| Database | Amazon RDS for PostgreSQL 16 |
| Hourly / daily cron triggers | EventBridge Scheduler |
| Secrets | AWS Secrets Manager |
| File uploads | Amazon S3 (versioning ON, lifecycle: retain forever) |
| Container registry | Amazon ECR (private) |
| Logs | CloudWatch Logs (30-day retention) |
| DNS | Route 53 |
| TLS | ACM (auto-renewing) |

Full deployment runbook and Terraform-equivalent step-by-step in [DEPLOYMENT.md](./DEPLOYMENT.md) (added once stack is provisioned).

## 15. Observability, Backups & Data Durability

**Non-negotiable: we will not lose data.** Concretely:

- **RDS automated backups**: 35-day retention (max), **point-in-time-recovery (PITR)** enabled. RPO = 5 minutes.
- **RDS daily snapshot copied to a second AWS region** as DR.
- **S3 bucket** for raw GAM CSV exports — versioning ON, lifecycle "retain forever". Every cron run also writes a copy of the raw fetched CSV here, so we can replay history if `gam_reports` is ever corrupted.
- **No data retention rollup** — `gam_reports` rows are kept forever. Storage cost at projected scale is negligible (single-digit GB/year).
- **Logs**: CloudWatch (free with App Runner) — structured Pino JSON. Retention 30 days.
- **Error tracking**: deferred to Phase 4 (Sentry SaaS recommended).
- **Health checks**: `/api/health` returns 200 only if DB is reachable and secrets are readable. App Runner uses this for ALB target health.
- **Cron health**: every run writes to `audit_log` with status. UI surfaces "last successful run" in the status bar; alert fires if no successful run in > 3 hours.

## 16. Milestones & Timeline

| Phase | Deliverable | Timeline | Priority | Blocked by |
| --- | --- | --- | --- | --- |
| **0** | Docs (PRD/ARCH/DECISIONS/RUNBOOK) + repo scaffold + Docker Compose + GitHub Actions CI | Day 1–2 | P0 | — |
| **1A** | DB schema + Prisma migrations + sample seed + read API endpoints + CSV upload endpoint | Week 1 | P0 | Phase 0 |
| **1B** | Dashboard UI: KPI cards + period selector + breakdown tables + trend chart + CSV upload page | Week 1–2 | P0 | Phase 1A |
| **2A** | GAM API integration (service account OAuth + hourly cron + 90-day backfill) | Week 2–3 | P0 | TL delivers GAM service account JSON |
| **2B** | Cross-dimensional analysis + top/bottom performers | Week 3 | P1 | Phase 1B |
| **2C** | Google Workspace SSO + roles + audit log + manual refresh button | Week 3–4 | P1 | Phase 1B |
| **3** | Cost tracking (manual + CSV) + ROI calculation + MGID API spend pull | Week 4 | P2 | TL delivers MGID Partner API key |
| **4** | Slack alerts + date-range comparison + custom date picker + Sentry | Week 5+ | P2 | Phase 3 |

## 17. Acceptance Criteria

A phase is "done" when **all** of the following pass:

1. **Functional**: every feature in the phase's deliverable list works end-to-end against the latest sample data.
2. **Build**: `pnpm install && pnpm build` succeeds with zero errors and zero `tsc` errors.
3. **Lint**: `pnpm lint` passes with zero errors.
4. **CI**: GitHub Actions workflow is green on the PR.
5. **Docker**: `docker compose up` brings up Postgres + API + Web with no manual steps beyond `.env` setup.
6. **Docs**: any new env var, API endpoint, or non-obvious decision is reflected in `README.md`, `API.md`, or a new ADR in `DECISIONS.md`.
7. **Demo**: a 5-minute walkthrough can be given to the TL, showing the new feature live.

## 18. Definition of Done

For every PR:

- Self-contained, small enough to review in < 30 min.
- Title and description follow the PR template.
- Touches only the scope it claims to touch (no unrelated refactors).
- New routes have request/response schemas; UI components have at least one Storybook story (Phase 2+).
- No secret values in code; only `.env.example` updated.
- README / API.md / migration files updated in the **same PR** as the code that depends on them.

## 19. Open Items / Pending External Inputs

| Item | Owner | Blocker for | Status |
| --- | --- | --- | --- |
| GAM Service Account JSON | Project TL | Phase 2A | Awaiting (runbook handed over) |
| Google Workspace domain to whitelist for SSO | Project owner | Phase 2C | Awaiting |
| Bootstrap admin email (`BOOTSTRAP_ADMIN_EMAIL`) | Project owner | Phase 2C | Awaiting |
| AWS account ID + IAM role for GitHub Actions OIDC | Project owner | Deployment | Awaiting |
| MGID Partner API key | Project TL | Phase 3 | Awaiting |
| Slack webhook URL (incoming webhook for alerts) | Project owner | Phase 4 | Awaiting |
| Custom domain confirmation (`app.groviaindia.shop` or alt) | Project owner | Deployment | Awaiting |

## Appendix A — GAM Key-Values Setup

Already configured in GAM Inventory → Key-Values:

| Key name | Value type | Reportable | Set via |
| --- | --- | --- | --- |
| `campaign` | Dynamic (freeform) | Yes — include values in reporting | `googletag.pubads().setTargeting('campaign', value)` |
| `source` | Dynamic (freeform) | Yes | same |
| `headline` | Dynamic (freeform) | Yes | same |
| `lander` | Dynamic (freeform) | Yes | same |
| `image` | Dynamic (freeform) | Yes | same |

### Frontend integration (already deployed on funnel pages)

```js
// On every page, URL params are captured and passed to GAM
var params = new URLSearchParams(window.location.search);
var keys = ['campaign', 'headline', 'image', 'source', 'lander'];
keys.forEach(function (key) {
  var val = params.get(key) || sessionStorage.getItem('jp_' + key);
  if (val) {
    googletag.pubads().setTargeting(key, val);
    sessionStorage.setItem('jp_' + key, val);
  }
});
googletag.pubads().setTargeting('page', window.location.pathname);
```

## Appendix B — Traffic URL Format

```
https://jobprivet.com/funnel/?campaign=camp01&headline=hl1&source=mgid&lander=funnel_v1&image=img1
```

## Appendix C — Change Log

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1.0 | 2026-06-12 | Heren Nagdewani | Initial draft (HTML) |
| 1.0.0 | 2026-06-15 | Engineering | Normalized to Markdown; locked stack (Fastify, Next.js, PostgreSQL, AWS); added §13–§19 (stack, infra, durability, milestones, acceptance, opens); preserved all original requirements |
