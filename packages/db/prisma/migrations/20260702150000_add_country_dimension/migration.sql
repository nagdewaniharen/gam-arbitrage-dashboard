-- Add `country` dimension to gam_reports. Defaults to '' so existing rows survive
-- the unique-constraint rebuild without backfill (a real refresh will repopulate
-- with actual COUNTRY_NAME values from GAM).

ALTER TABLE "gam_reports" ADD COLUMN "country" TEXT NOT NULL DEFAULT '';

-- Rebuild the unique constraint so (network, date, ..., site, country, page) is unique.
DROP INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key";

CREATE UNIQUE INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key"
  ON "gam_reports" ("network_id", "date", "campaign", "source", "headline", "lander", "image", "ad_unit", "site", "country", "page");

CREATE INDEX "gam_reports_date_country_idx" ON "gam_reports" ("date", "country");
