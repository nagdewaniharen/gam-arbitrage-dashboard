#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# AWS provisioning for GAM Arbitrage Reporting Dashboard.
# Prerequisites:
#   - AWS CLI configured (aws sts get-caller-identity must succeed)
#   - AWS_REGION env var (defaults to ap-south-1)
#   - Domain delegated to Route 53 (or DNS managed elsewhere — script prints
#     the CNAME you need to add at your DNS provider).
#
# Run with:    bash infra/aws/setup.sh
# Idempotent:  re-running detects already-created resources.
# ----------------------------------------------------------------------------
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
APP_NAME="${APP_NAME:-gam-arbitrage}"
GH_OIDC_AUDIENCE="sts.amazonaws.com"

# Read AWS account ID (also verifies credentials work)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✓ AWS account: $ACCOUNT_ID  region: $AWS_REGION"

# ---- 1. ECR repository ----
if ! aws ecr describe-repositories --repository-names "$APP_NAME-api" --region "$AWS_REGION" > /dev/null 2>&1; then
  aws ecr create-repository \
    --repository-name "$APP_NAME-api" \
    --region "$AWS_REGION" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability MUTABLE > /dev/null
  echo "✓ ECR repo $APP_NAME-api created"
else
  echo "  ECR repo $APP_NAME-api already exists"
fi

# ---- 2. S3 bucket for raw GAM CSV exports ----
BUCKET="$APP_NAME-raw-reports-$ACCOUNT_ID"
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$AWS_REGION" 2>/dev/null; then
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration "LocationConstraint=$AWS_REGION" > /dev/null
  aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  echo "✓ S3 bucket $BUCKET created (versioning on, public access blocked)"
else
  echo "  S3 bucket $BUCKET already exists"
fi

# ---- 3. Secrets in Secrets Manager ----
function ensure_secret() {
  local name=$1
  local description=$2
  if ! aws secretsmanager describe-secret --secret-id "$name" --region "$AWS_REGION" > /dev/null 2>&1; then
    aws secretsmanager create-secret \
      --name "$name" \
      --description "$description" \
      --region "$AWS_REGION" > /dev/null
    echo "✓ Secret $name created (empty — fill in via console or CLI)"
  else
    echo "  Secret $name already exists"
  fi
}
ensure_secret "$APP_NAME/database-url"            "Supabase Postgres URL (session pooler)"
ensure_secret "$APP_NAME/gcp-service-account"     "GAM Reporting service account JSON"
ensure_secret "$APP_NAME/internal-cron-secret"    "HMAC secret for EventBridge -> API"
ensure_secret "$APP_NAME/mgid-api-key"            "MGID Partner API key"
ensure_secret "$APP_NAME/nextauth-secret"         "NextAuth JWT signing key"
ensure_secret "$APP_NAME/google-oauth-client-id"  "Google OAuth client ID"
ensure_secret "$APP_NAME/google-oauth-client-secret" "Google OAuth client secret"
ensure_secret "$APP_NAME/slack-webhook-url"       "Slack incoming webhook URL"

# ---- 4. IAM role for GitHub Actions OIDC ----
ROLE_NAME="$APP_NAME-github-deploy"
if ! aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  cat > /tmp/$ROLE_NAME-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "${GH_OIDC_AUDIENCE}"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:*/${APP_NAME}*:*"
      }
    }
  }]
}
EOF
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file:///tmp/$ROLE_NAME-trust.json > /dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AWSAppRunnerFullAccess
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess-Amplify
  echo "✓ IAM role $ROLE_NAME created (attach OIDC provider if missing)"
else
  echo "  IAM role $ROLE_NAME already exists"
fi

# ---- 5. EventBridge Scheduler — hourly GAM refresh ----
SCHEDULER_GROUP="$APP_NAME-crons"
if ! aws scheduler get-schedule-group --name "$SCHEDULER_GROUP" --region "$AWS_REGION" > /dev/null 2>&1; then
  aws scheduler create-schedule-group --name "$SCHEDULER_GROUP" --region "$AWS_REGION" > /dev/null
  echo "✓ Scheduler group $SCHEDULER_GROUP created"
else
  echo "  Scheduler group $SCHEDULER_GROUP already exists"
fi

cat <<EOF

==============================================
Provisioning complete.

ECR repo:     $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME-api
S3 bucket:    $BUCKET
Deploy role:  arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME

NEXT STEPS:
  1. Fill in the secrets:
     aws secretsmanager put-secret-value --secret-id $APP_NAME/database-url --secret-string '<your Supabase URL>'
     aws secretsmanager put-secret-value --secret-id $APP_NAME/gcp-service-account --secret-string file://secrets/gam-service-account.json
     (repeat for the other secrets)

  2. Add OIDC identity provider in IAM if not already present:
     aws iam create-open-id-connect-provider \\
       --url https://token.actions.githubusercontent.com \\
       --client-id-list $GH_OIDC_AUDIENCE \\
       --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

  3. Add these GitHub Secrets to your repo settings:
     AWS_DEPLOY_ROLE_ARN     = arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME
     APP_RUNNER_API_ARN      = (after step 4, paste here)
     AMPLIFY_APP_ID          = (after step 5, paste here)

  4. Create App Runner service via console (one-time):
     https://console.aws.amazon.com/apprunner
     - Source: ECR -> $APP_NAME-api -> latest
     - Auto-deploy: ON
     - Instance: 1 vCPU / 2 GB
     - Env from Secrets Manager: select all $APP_NAME/* secrets

  5. Create Amplify app via console (one-time):
     https://console.aws.amazon.com/amplify
     - Connect GitHub repo, branch=main
     - Monorepo: apps/web
     - Build settings: auto-detected for Next.js 15

  6. Add EventBridge Schedule (after App Runner has a URL):
     aws scheduler create-schedule \\
       --name gam-hourly-refresh \\
       --group-name $SCHEDULER_GROUP \\
       --schedule-expression "cron(0 * * * ? *)" \\
       --target '{"Arn":"<App Runner ARN>","RoleArn":"<Role>","HttpParameters":{"PathParameters":{},"HeaderParameters":{}}}' \\
       --flexible-time-window '{"Mode":"OFF"}'

==============================================
EOF
