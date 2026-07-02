-- Add `country` dimension to gam_reports. Defaults to '' so existing rows survive
-- the unique-constraint rebuild without backfill (a real refresh will repopulate
-- with actual COUNTRY_NAME values from GAM).

ALTER TABLE "gam_reports" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT '';

-- Drop any old unique indexes for gam_reports (name may differ if Supabase was
-- provisioned via `prisma db push` rather than migrations). This tolerates
-- both the Prisma-generated name and any variant.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT indexname FROM pg_indexes
           WHERE tablename = 'gam_reports'
             AND indexname LIKE 'gam_reports_network_id_date_campaign_source_headline_lander%'
  LOOP
    EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(r.indexname);
  END LOOP;
END $$;

-- Rebuild unique constraint so (network, date, ..., site, country, page) is unique.
CREATE UNIQUE INDEX "gam_reports_network_id_date_campaign_source_headline_lander_key"
  ON "gam_reports" ("network_id", "date", "campaign", "source", "headline", "lander", "image", "ad_unit", "site", "country", "page");

CREATE INDEX IF NOT EXISTS "gam_reports_date_country_idx" ON "gam_reports" ("date", "country");
