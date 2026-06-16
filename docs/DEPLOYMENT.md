# Deployment Runbook — GAM Arbitrage Reporting Dashboard

> End-to-end deploy in ~60 minutes. Idempotent — safe to re-run.
> Target stack: **AWS** (App Runner + Amplify + EventBridge + Secrets Manager + S3 + ECR), with **Supabase Pro** as the database.

## Prerequisites

- AWS account with admin access (or sufficient IAM permissions to create roles, App Runner, Amplify, EventBridge, Secrets Manager, ECR, S3).
- AWS CLI installed + configured: `aws sts get-caller-identity` must work.
- GitHub repository created (private) with this code pushed.
- Supabase Pro project with both URLs ready (Session Pooler for `DATABASE_URL` + `DIRECT_URL`).
- These secrets ready on hand:
  - GAM Service Account JSON (`secrets/gam-service-account.json`)
  - Supabase Postgres URL
  - Google OAuth Client ID + Secret (from GCP)
  - MGID Partner API key (optional — Phase 3)
  - Slack incoming webhook URL (optional — Phase 4)

## Step 1 — Provision AWS infrastructure

```bash
cd ~/Desktop/GAM_Arbitrage_Reporting_Dashboard
export AWS_REGION=ap-south-1
bash infra/aws/setup.sh
```

This creates: ECR repo, S3 bucket for raw CSVs, all Secrets Manager entries (empty), IAM role for GitHub Actions OIDC, EventBridge scheduler group.

## Step 2 — Fill in the secrets

```bash
APP=gam-arbitrage
aws secretsmanager put-secret-value --secret-id $APP/database-url \
  --secret-string 'postgresql://postgres.xxx:PASSWORD@aws-x-region.pooler.supabase.com:5432/postgres'
aws secretsmanager put-secret-value --secret-id $APP/gcp-service-account \
  --secret-string file://secrets/gam-service-account.json
aws secretsmanager put-secret-value --secret-id $APP/internal-cron-secret \
  --secret-string "$(openssl rand -hex 32)"
aws secretsmanager put-secret-value --secret-id $APP/nextauth-secret \
  --secret-string "$(openssl rand -hex 32)"
# Optional (fill when keys arrive):
# aws secretsmanager put-secret-value --secret-id $APP/mgid-api-key --secret-string '<key>'
# aws secretsmanager put-secret-value --secret-id $APP/google-oauth-client-id --secret-string '<id>'
# aws secretsmanager put-secret-value --secret-id $APP/google-oauth-client-secret --secret-string '<secret>'
# aws secretsmanager put-secret-value --secret-id $APP/slack-webhook-url --secret-string 'https://hooks.slack.com/...'
```

## Step 3 — Configure GitHub Actions OIDC

If the OIDC provider doesn't exist yet:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

In GitHub → repo → Settings → Secrets and variables → Actions, add:
- `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::<account>:role/gam-arbitrage-github-deploy`
- `APP_RUNNER_API_ARN` = (added after Step 4)
- `AMPLIFY_APP_ID` = (added after Step 5)

## Step 4 — Create App Runner service (one-time, console UI)

1. https://console.aws.amazon.com/apprunner → **Create service**
2. Source: **Container registry → Amazon ECR**
3. ECR image: `<account>.dkr.ecr.ap-south-1.amazonaws.com/gam-arbitrage-api:latest`
4. Deployment trigger: **Automatic**
5. ECR access role: use existing (or create AppRunnerECRAccessRole)
6. Service name: `gam-arbitrage-api`
7. Instance: **1 vCPU / 2 GB**
8. Environment variables → reference Secrets Manager:
   - `DATABASE_URL` → `gam-arbitrage/database-url`
   - `DIRECT_URL` → `gam-arbitrage/database-url`
   - `GAM_SERVICE_ACCOUNT_JSON` → `gam-arbitrage/gcp-service-account`
   - `INTERNAL_CRON_SECRET` → `gam-arbitrage/internal-cron-secret`
   - `NEXTAUTH_SECRET` → `gam-arbitrage/nextauth-secret`
   - `MGID_API_KEY` → `gam-arbitrage/mgid-api-key`
   - `SLACK_WEBHOOK_URL` → `gam-arbitrage/slack-webhook-url`
9. Health-check path: `/api/health`
10. Create.

Copy the App Runner **service ARN** and **default URL** (e.g. `https://abc123.ap-south-1.awsapprunner.com`).

## Step 5 — Create Amplify app for the web frontend (one-time, console UI)

1. https://console.aws.amazon.com/amplify → **New app → Host web app**
2. Source: **GitHub**, authorize, pick the private repo, branch `main`.
3. Monorepo settings: **Yes**, app root: `apps/web`.
4. Build settings: leave auto-detected (Next.js 15 SSR).
5. Environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://<app-runner-url-from-step-4>`
   - `NEXT_PUBLIC_NETWORK_CODE` = `23340025403`
   - `GOOGLE_OAUTH_CLIENT_ID` = (after creating OAuth credentials)
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `ALLOWED_GOOGLE_DOMAIN` = `groviaindia.shop` (or whichever Workspace domain)
   - `BOOTSTRAP_ADMIN_EMAIL` = (e.g. `tech@knnsyndicate.com`)
   - `NEXTAUTH_URL` = `https://app.groviaindia.shop`
   - `NEXTAUTH_SECRET` = same as App Runner
6. Save & deploy.
7. Copy the Amplify **App ID** → paste as `AMPLIFY_APP_ID` GitHub secret.

## Step 6 — Custom domain

After App Runner + Amplify both have default URLs:

1. **Web**: Amplify → Domain Management → Add domain `app.groviaindia.shop`.
2. **API**: App Runner → Custom domain → `api.groviaindia.shop`.

Both will print a CNAME for you to add at your DNS provider (Cloudflare / Route 53 / wherever `groviaindia.shop` is managed). Add → ACM issues TLS within ~10 min → both subdomains are live HTTPS.

## Step 7 — Configure the hourly cron via EventBridge Scheduler

```bash
APP=gam-arbitrage
APP_RUNNER_URL="https://api.groviaindia.shop"   # or the default App Runner URL
CRON_SECRET=$(aws secretsmanager get-secret-value --secret-id $APP/internal-cron-secret --query SecretString --output text)

# Compute payload + HMAC for an empty body, then have EventBridge attach headers
# at trigger time. Simplest is to use a Lambda target that signs the request,
# OR use EventBridge's "HTTPS target with header parameters" feature directly.
# Detailed how-to: see infra/aws/eventbridge-cron.md
```

For day-1 we can run the cron from **GitHub Actions** instead (`.github/workflows/cron-hourly.yml`) — simpler than the Lambda signer setup. EventBridge upgrade comes once the dashboard is in steady-state.

## Step 8 — Initial backfill (one-shot)

After App Runner is live:

```bash
curl -X POST https://api.groviaindia.shop/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"backfill": true}'
```

This kicks off a 90-day pull. Watch CloudWatch logs for progress.

## Step 9 — Smoke test the live URLs

```bash
curl -fsS https://api.groviaindia.shop/api/health
curl -fsS https://api.groviaindia.shop/api/status
curl -fsS https://api.groviaindia.shop/api/stats?period=7d | jq .
open https://app.groviaindia.shop
```

## Rollback

- **Web (Amplify)**: revert to a previous deploy from the Amplify console (one-click).
- **API (App Runner)**: in console → Deployments tab → choose previous image tag → re-deploy.
- **Database**: Supabase Pro provides PITR — restore to any second in the last 7 days.

## Monitoring

- **CloudWatch Logs**:
  - `/aws/apprunner/gam-arbitrage-api/<service-id>/application` → all API logs (structured Pino JSON).
  - Search by `correlationId` to follow one request across log lines.
- **CloudWatch Alarm** (recommended day 2):
  - Metric: API health-check failures > 3 in 5 min → SNS → Slack.
- **Supabase Dashboard**: real-time DB metrics + query insights.

## Cost estimate (steady state)

| Service | Monthly USD |
| --- | --- |
| App Runner (1 vCPU / 2 GB, always-on) | ~$25 |
| Amplify (SSR, low traffic) | ~$10 |
| ECR (image storage) | $1 |
| S3 (raw CSV history) | $1 |
| Secrets Manager (8 secrets) | $3 |
| CloudWatch (30-day retention) | $2 |
| Data egress | ~$5 |
| Route 53 hosted zone | $0.50 |
| Supabase Pro | $25 |
| **Total** | **~$70/mo** |

## Disaster recovery

- **DB**: Supabase Pro PITR (7 days). Recovery procedure: Supabase dashboard → Database → Backups → Point-in-time restore.
- **Raw CSVs**: every hourly run also writes the raw GAM CSV to S3 (lifecycle: keep forever, versioned). If `gam_reports` is ever corrupted, we replay the CSVs via `pnpm db:migrate:reset && pnpm db:seed:empty && for f in s3://…; do curl POST /api/upload-csv -F file=@$f; done`.
