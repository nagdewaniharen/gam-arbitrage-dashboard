# Architectural Decision Log

We record significant decisions here so future maintainers (and outsourced contractors) can understand *why* the codebase looks the way it does.

Each ADR is a small, append-only record. Format:

```
## ADR-NNN — <title>
- **Date**: YYYY-MM-DD
- **Status**: Accepted | Superseded by ADR-XXX
- **Context**: what problem we faced
- **Decision**: what we chose
- **Consequences**: trade-offs we accepted
```

---

## ADR-001 — Fastify (not Express) for the backend
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §12 said "developer's choice" between Node.js + Express and Node.js + FastAPI/Fastify. We needed a backend that's production-ready, outsource-friendly, and reduces the chance of broken API contracts.
- **Decision**: Use **Node.js 20 + Fastify 5 + TypeScript**.
- **Consequences**:
  - 2–3× higher throughput than Express.
  - JSON Schema on every route → automatic request/response validation + auto-generated OpenAPI/Swagger UI.
  - Built-in Pino logging.
  - Contractors must learn Fastify's plugin model (mild ramp).

## ADR-002 — Next.js (not vanilla JS/Alpine) for the frontend
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §9.1 said "no framework required: Vanilla JS or lightweight (Alpine.js / Preact acceptable)". We want a stack any senior React contractor can jump into.
- **Decision**: **Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn/ui + TanStack Query + Recharts**.
- **Consequences**:
  - Heavier bundle than vanilla JS, but cached and SSR'd — well under the 2 s p95 budget.
  - Massive ecosystem; easy hiring.
  - Storybook-friendly component model.
  - Routes-as-files and server components reduce boilerplate.

## ADR-003 — PostgreSQL (not SQLite) from day 1
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §12 suggested SQLite in dev → PG in prod. Migration later is wasted effort.
- **Decision**: **PostgreSQL 16 + Prisma ORM** in both dev and prod.
- **Consequences**:
  - One extra Docker container in local dev (negligible).
  - Concurrent writes (cron + manual refresh + API reads) just work.
  - Access to `citext`, `pgcrypto`, JSONB, window functions.
  - Production deploys to RDS without code change.

## ADR-004 — Monorepo with pnpm workspaces + Turborepo
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: API and Web share types (`@gam/types`) and a DB layer (`@gam/db`). Splitting them into multiple repos creates type-sync drift.
- **Decision**: Single repo, three workspaces: `apps/api`, `apps/web`, `packages/{db,types}`. Builds orchestrated with **Turborepo**.
- **Consequences**:
  - One PR can change contract + producer + consumer atomically.
  - Cold-clone setup is slightly heavier (~1 GB node_modules).
  - Caching with Turbo keeps CI fast.

## ADR-005 — AWS as the deploy target (not Hetzner VPS)
- **Date**: 2026-06-15
- **Status**: Accepted (supersedes the Hetzner direction in PRD §12)
- **Context**: Original PRD specified a Hetzner VPS at `204.168.237.255`. Product owner switched to AWS for managed services and easier outsourcing handover.
- **Decision**: **Amplify (web) + App Runner (api) + RDS (db) + EventBridge (cron) + Secrets Manager + S3 + ECR + CloudWatch**.
- **Consequences**:
  - Higher monthly bill ($80–120) than a single VPS ($5–15) — accepted for the operational maturity.
  - No SSH/systemd/nginx setup needed; App Runner + Amplify are zero-touch deploys.
  - GitHub Actions deploys via OIDC; no long-lived keys.
  - Daily snapshots + PITR satisfy data-durability requirement explicitly stated by product owner.

## ADR-006 — Phase 1 access via private URL + Basic Auth at edge (no app-level login)
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §11 said Phase 1 = "no auth, accessed via private URL". But the dashboard will be touched by outsourced contractors, so we want at least an edge-layer gate.
- **Decision**: Phase 1 enforces **HTTP Basic Auth via Amplify rewrite headers** in front of both the web app and the API. App-level SSO ships in Phase 2C.
- **Consequences**:
  - Trivial to configure (Amplify console + header).
  - Doesn't leak content if URL is shared.
  - One credential rotation needed when Phase 2C ships.

## ADR-007 — Google Workspace SSO via NextAuth (not Keycloak)
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: Product owner suggested Keycloak as one option. We have a single app and an existing Google Workspace.
- **Decision**: **NextAuth (Auth.js v5) + Google OAuth provider, domain-restricted**. Roles in DB.
- **Consequences**:
  - Zero extra infra; ~2 hours to wire up.
  - Users managed entirely from Google Admin Console (deactivate Google account → loses dashboard access).
  - If we ever need centralized IdP for ≥ 3 apps, swap to Keycloak (or Cognito) without rewriting routes.

## ADR-008 — Multi-tenant ready, single-tenant in use
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: Today we only serve River Five Global (network `<YOUR_NETWORK_CODE>`). Future may add networks.
- **Decision**: Every reporting row carries `network_id`. Today every query implicitly scopes to the single network; tomorrow we flip a config and add per-user network ACLs without a migration.
- **Consequences**:
  - One extra column on hot tables (cheap).
  - Single-tenant queries occasionally include redundant `WHERE network_id =` (negligible).

## ADR-009 — Recharts over Chart.js or hand-rolled CSS bars
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §9.3.3 preferred CSS bars under the original "no framework" constraint. Now we have React.
- **Decision**: **Recharts** — composable React components, dark-theme friendly, tree-shakes to ~40 KB gzipped.
- **Consequences**:
  - Slightly larger bundle than CSS bars.
  - We don't reinvent axis rendering / tooltips.
  - Easy to add new chart types later (line, area) without re-architecting.

## ADR-010 — CSV upload as Phase 1 fallback, never removed
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: GAM service account is in TL's hands and may take days. CSV upload was already in PRD §8.4 / §9.3.8 as a "fallback".
- **Decision**: CSV upload is **first-class**, not just a stopgap. Same parser is used by the GAM cron and by manual uploads, so improvements benefit both paths.
- **Consequences**:
  - One more endpoint to maintain — worth it.
  - Audits become possible: paste a CSV from GAM, see exactly which rows our cron would have inserted.

## ADR-011 — Supabase Pro for the production database (superseding RDS plan)
- **Date**: 2026-06-16
- **Status**: Accepted (supersedes the RDS direction in ADR-005)
- **Context**: ADR-005 picked AWS RDS, but Supabase Pro gives PITR + daily backups + a browsable Table Editor at $25/mo, satisfying PRD §15 durability. RDS adds ops overhead for marginal benefit at our scale.
- **Decision**: **Supabase Pro** is the production DB. Connection via session-pooler URL for both runtime and migrations (Supabase disables IPv4 on the direct connection).
- **Consequences**:
  - One less AWS service to manage.
  - TL / outsourced devs can be granted read-only access to Supabase Table Editor without VPN setup.
  - If we outgrow Supabase, `pg_dump → pg_restore` to RDS is a 30-min migration.

## ADR-012 — GAM client via raw SOAP, not `googleapis` package
- **Date**: 2026-06-16
- **Status**: Accepted
- **Context**: The `googleapis` npm package's GAM surface is partial and unstable across versions; the REST migration is incomplete; the official SOAP `ReportService.runReportJob → getReportJobStatus → getReportDownloadURL` flow is the canonical and reliable path.
- **Decision**: Hand-rolled SOAP envelope construction in `apps/api/src/services/gam-client.ts`, authenticated with `google-auth-library` (JWT → access token), version `v202511`. Element order matches GAM XSD strictly. Version is env-overridable via `GAM_API_VERSION`.
- **Consequences**:
  - ~150 lines of XML strings to maintain.
  - When Google retires v202511 (~9 months), bump `GAM_API_VERSION` in env; if XSD changes, re-order elements per fault response.
  - Zero dependency on a fragile third-party GAM wrapper.

## ADR-013 — Workspace SSO via NextAuth JWT cookies (no React SessionProvider)
- **Date**: 2026-06-16
- **Status**: Accepted
- **Context**: NextAuth v5 (beta) ships `next-auth/react` SessionProvider with unstable export paths across betas.
- **Decision**: Use JWT-cookie-only auth flow. Sign-in via direct `<a href="/api/auth/signin/google">` link. Frontend reads session from `/api/auth/session` directly with TanStack Query. Edge middleware decodes JWT claims for quick gating; the Fastify API independently verifies the same JWT before serving data.
- **Consequences**:
  - No `useSession()` hook in client components — minor DX cost.
  - Eliminates the most common NextAuth v5 beta breakage class.
  - Identity layer is portable: same cookie validation works in App Runner, AWS Lambda, or any Node host.

## ADR-014 — Workspace gate is strict by default; refuse to start in "any-Google-account" mode
- **Date**: 2026-06-16
- **Status**: Accepted
- **Context**: If `GOOGLE_OAUTH_CLIENT_ID` is configured but `ALLOWED_GOOGLE_DOMAIN` is missing, the safest behavior is to FAIL closed (refuse SSO) rather than allow ANY Google account.
- **Decision**: Boot-time check logs `FATAL` and disables SSO. Also pass `hd=<domain>` to Google's OAuth screen for defense-in-depth and re-verify `profile.hd === ALLOWED_GOOGLE_DOMAIN` server-side in the signIn callback.
- **Consequences**:
  - Misconfiguration is immediately visible.
  - No silent expansion of access.
  - Admin-only pages additionally gated by `role === 'admin'` claim at the edge.

## ADR-015 — Real GAM network code is never in committed source
- **Date**: 2026-06-16
- **Status**: Accepted
- **Context**: Product owner asked that the production network code (publicly identifying the publisher) never appear in any commit. The PRD originally carried it as a default value.
- **Decision**: All source, configs, and docs use the placeholder `<YOUR_NETWORK_CODE>` or read `env.GAM_NETWORK_CODE`. Zod env validation makes the variable required at boot. Real value lives only in `.env` (gitignored) and AWS Secrets Manager.
- **Consequences**:
  - Cold-clone setup requires copying `.env.example → .env` and filling in the real code (already documented in README).
  - Outsourced devs can be onboarded with a DEMO_NETWORK code for staging without exposing the prod one.

## ADR-016 — Substitute PRD's missing AD_EXCHANGE_LINE_ITEM_LEVEL_* metrics with the regular AD_EXCHANGE_* family
- **Date**: 2026-06-20
- **Status**: Accepted
- **Context**: PRD §7.1 / §8.3 specified `AD_EXCHANGE_LINE_ITEM_LEVEL_REQUESTS`, `..._MATCH_RATE`, `..._IMPRESSIONS`, `..._CLICKS`, `..._REVENUE`, `..._AVERAGE_ECPM`, `..._PERCENT_VIEWABLE_IMPRESSIONS`. **Verified in the GAM metric picker** that these line-item-level variants do NOT exist on River Five Global because the network doesn't use AdX line items (all monetization runs through direct campaigns / header bidding). API returns empty CSV; UI picker doesn't list them.
- **Decision**: Use the regular `AD_EXCHANGE_*` family instead, all confirmed working with real data on our network:
  - `AD_EXCHANGE_IMPRESSIONS`
  - `AD_EXCHANGE_CLICKS`
  - `AD_EXCHANGE_REVENUE`
  - `AD_EXCHANGE_AVERAGE_ECPM`
  - `AD_EXCHANGE_TOTAL_REQUESTS`
  - `AD_EXCHANGE_RESPONSES_SERVED`
  - `AD_EXCHANGE_MATCH_RATE` (native — no need to compute from REQUESTS/RESPONSES_SERVED)
  - `AD_EXCHANGE_ACTIVE_VIEW_PERCENT_VIEWABLE_IMPRESSIONS`
- **Consequences**:
  - Match rate field gains real values (was always 0 under PRD's metric choice).
  - Total requests + responses served exposed for fill-rate analysis (better than what PRD asked for).
  - Parser accepts both new and legacy column names so existing CSV uploads keep working.
  - Substitution communicated to PRD owner (Heren) before merging.

## ADR-017 — RPV formula uses configurable AVG_ADS_PER_PAGE (default 2)
- **Date**: 2026-06-20
- **Status**: Accepted
- **Context**: PRD §9.3.1 defines `RPV = revenue / (impressions / avg_ads_per_page)`. The formula is specified but `avg_ads_per_page` is operational data — depends on funnel design, not GAM.
- **Decision**: Make `AVG_ADS_PER_PAGE` an env var (default `2`). Web reads `NEXT_PUBLIC_AVG_ADS_PER_PAGE`. Verified on `jobprivet.com/funnel/` source: 1× `defineSlot` (site_top banner) + 1× `defineOutOfPageSlot` (site_rewarded) = 2 ad slots per typical funnel page.
- **Consequences**:
  - RPV value is now mathematically correct ("$ per visit") instead of `revenue / impressions` (which equals eCPM/1000).
  - If a future funnel template adds more ad slots, change the env var; no code deploy.
  - Eventually replaceable with a GA4-driven real-visits integration (would supersede this ADR).

## ADR-018 — Custom-targeting breakdown (campaign/source/headline/lander/image) deferred
- **Date**: 2026-06-20
- **Status**: Open — needs GAM admin investigation
- **Context**: PRD §7.2 requires the dashboard to show revenue broken down by 5 custom targeting keys: campaign, source, headline, lander, image. We verified that the keys are configured in GAM Admin → Inventory → Key-values (CLI `pnpm --filter @gam/api gam:keys` lists IDs 19566476 / 19542339 / 19542333 / 19542345 / 19542366), and they're set via `googletag.pubads().setTargeting()` on jobprivet.com funnel pages.
- **Decision**: For now, the GAM SOAP report pulls `DATE + AD_UNIT_NAME` only — no custom dimensions. Real numbers flow daily but campaign/source/headline/lander/image columns in `gam_reports` stay empty. The dashboard's breakdown sections render with empty rows.
- **Why**: Every attempt to combine `customDimensionKeyIds` with any combination of metrics and dimensions returns `ReportError.INVALID_CUSTOM_CRITERIA_DIMENSION`. Tried:
  - AD_EXCHANGE_* metrics + `CUSTOM_TARGETING_VALUE_ID` dimension + customDimensionKeyIds → INVALID_CUSTOM_CRITERIA_DIMENSION
  - AD_EXCHANGE_* metrics + `CUSTOM_CRITERIA` dimension + customDimensionKeyIds → same
  - AD_EXCHANGE_* metrics + no dimension + customDimensionKeyIds → same
  - AD_SERVER_* metrics + no dimension + customDimensionKeyIds → same
- **Consequences**:
  - Aggregate KPIs (revenue, impressions, eCPM, clicks, RPV) work today against real data.
  - Per-campaign / per-source analysis must wait until either (a) GAM API access settings allow custom-targeting reporting on this network, or (b) we find the right combination of dimensions/metrics/customDimensionKeyIds for v202511. Likely candidates to try next: SAVED_QUERY / dimensionAttributes / statement-filter approach.
  - `pnpm --filter @gam/api gam:keys` CLI is kept (it works) so the moment we unblock this, we have the IDs ready.
  - `GAM_CUSTOM_KEY_IDS` env var is documented in `.env.example` for forward compatibility.
