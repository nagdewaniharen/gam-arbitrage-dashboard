-- Add `site` dimension to gam_reports. Defaults to '' so existing rows survive
-- the unique-constraint rebuild without backfill (a real refresh will repopulate
-- them with actual domain values pulled from GAM's DOMAIN dimension).

ALTER TABLE "gam_reports" ADD COLUMN "site" TEXT NOT NULL DEFAULT '';

-- Rebuild the unique constraint so (network, date, ..., site, page) is unique.
DROP INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key";

CREATE UNIQUE INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key"
  ON "gam_reports" ("network_id", "date", "campaign", "source", "headline", "lander", "image", "ad_unit", "site", "page");

CREATE INDEX "gam_reports_date_site_idx" ON "gam_reports" ("date", "site");
