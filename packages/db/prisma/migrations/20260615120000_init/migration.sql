-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "CronStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('slack');

-- CreateTable
CREATE TABLE "gam_reports" (
    "id" BIGSERIAL NOT NULL,
    "network_id" TEXT NOT NULL DEFAULT '23340025403',
    "date" DATE NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "lander" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "ad_unit" TEXT NOT NULL DEFAULT '',
    "page" TEXT NOT NULL DEFAULT '',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "ecpm" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "viewability" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "match_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gam_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend" (
    "id" BIGSERIAL NOT NULL,
    "network_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "entered_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" BIGSERIAL NOT NULL,
    "job" TEXT NOT NULL,
    "status" "CronStatus" NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "rows_affected" INTEGER,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparison" TEXT NOT NULL,
    "threshold" DECIMAL(10,4) NOT NULL,
    "channel" "AlertChannel" NOT NULL DEFAULT 'slack',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" BIGSERIAL NOT NULL,
    "rule_id" UUID NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "context" JSONB,
    "fired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gam_reports_date_idx" ON "gam_reports"("date");

-- CreateIndex
CREATE INDEX "gam_reports_date_campaign_idx" ON "gam_reports"("date", "campaign");

-- CreateIndex
CREATE INDEX "gam_reports_date_source_idx" ON "gam_reports"("date", "source");

-- CreateIndex
CREATE INDEX "gam_reports_date_ad_unit_idx" ON "gam_reports"("date", "ad_unit");

-- CreateIndex
CREATE INDEX "gam_reports_network_id_date_idx" ON "gam_reports"("network_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key" ON "gam_reports"("network_id", "date", "campaign", "source", "headline", "lander", "image", "ad_unit", "page");

-- CreateIndex
CREATE INDEX "ad_spend_date_idx" ON "ad_spend"("date");

-- CreateIndex
CREATE INDEX "ad_spend_date_campaign_idx" ON "ad_spend"("date", "campaign");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_network_id_date_campaign_source_key" ON "ad_spend"("network_id", "date", "campaign", "source");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "cron_runs_job_started_at_idx" ON "cron_runs"("job", "started_at");

-- CreateIndex
CREATE INDEX "alert_events_rule_id_fired_at_idx" ON "alert_events"("rule_id", "fired_at");

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

