# Diagnostic / setup scripts

## IMPORTANT — how to run these
These scripts import `googleapis`, which is installed in `apps/api`
(not in this `scripts/` folder). Node resolves packages next to the
script file, so to run any of them you must copy the file into
`apps/api/` first, run it there, then delete the copy:

```bash
# 1. copy the script into apps/api (where googleapis is installed)
cp scripts/<file>.ts apps/api/

# 2. run it from apps/api (note: ../../.env -> project root)
cd apps/api
node --env-file=../../.env --experimental-strip-types <file>.ts

# 3. remove the working copy (the original stays in scripts/)
rm apps/api/<file>.ts
```

The originals always stay in `scripts/`. The copy in `apps/api/` is
only there to run, and is deleted afterwards.

(Note: trigger-cron.ts uses only Node built-ins — crypto + fetch — so it can
technically run from anywhere, but the same copy-run-delete flow works fine.)

---

## SETUP / ACCESS

### get-refresh-token.ts
Generates `GAM_OAUTH_REFRESH_TOKEN`. Run once (or again only if the token
expires/is revoked). Opens a Google login (https://admanager.google.com/)
-> approve with a GAM-enabled account -> prints the refresh token to paste
into `.env`.

### check-gam-access.ts
Diagnostic: "do my GAM credentials have access to any network?" Calls
`getAllNetworks` and prints accessible networks (or the error). Tells you
whether a problem is an access issue vs. a code issue.

---

## COLUMN / DIMENSION DISCOVERY
(These were used, in roughly this order, to figure out which GAM report
columns actually return data for this network — since many silently return
nothing. Run any of them when /api/refresh succeeds but a column/metric comes
back empty, to find the right column name.)

### gam-probe.ts
The FIRST probe. "Which metric columns return data for this network?" Tries
several column families (TOTAL_AD_EXCHANGE, TOTAL_LINE_ITEM_LEVEL,
AD_EXCHANGE_LINE_ITEM_LEVEL, TOTAL_IMPRESSIONS) for the last 30 days with just
the DATE dimension, and prints the row count + first lines of each. This is how
we found that AD_EXCHANGE_LINE_ITEM_LEVEL_* columns hold this network's data.

### gam-metrics-probe.ts
Tests whether viewability + match_rate + requests columns can be ADDED to the
known-working query. Tries the columns in 3 combos and prints the result. (This
revealed GAM silently DROPS unsupported columns — they vanish from the output
header instead of erroring — which led to the deeper checks below.)

### gam-viewability-debug.ts
Prints the FULL raw GAM response when requesting viewability/match_rate, and
tests several alternate column-name spellings. Used to tell the difference
between "column rejected" vs "column silently dropped." Confirmed the columns
are accepted (HTTP 200) but return no data under the line-item-level names.

### gam-viewability-values.ts
Downloads the actual report with the full column set and prints the real
HEADER + values + a column-count check (">>> GAM DROPPED some columns" vs
">>> all present"). This is what proved the line-item-level viewability/
match_rate columns return nothing for this network — and pointed us to look
for the correct Active View column names.

### gam-activeview-probe.ts
Tests the CORRECT viewability columns (AD_EXCHANGE_ACTIVE_VIEW_*). Confirmed
`AD_EXCHANGE_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS_RATE` returns real viewability as
a 0-1 fraction (e.g. 0.7742 = 77.42%). This is the column now used in
gam-client.ts for viewability.

### gam-matchrate-probe.ts
Tests several candidate match_rate / coverage column names and prints which
RETURN DATA vs are DROPPED, with a sample value for each. Confirmed
`AD_EXCHANGE_MATCH_RATE` returns real match rate as a 0-1 fraction (e.g.
0.7415 = 74.15%). This is the column now used in gam-client.ts for match_rate.

---

## CRON

### trigger-cron.ts
Calls the HMAC-protected `/internal/cron/refresh` endpoint exactly as AWS
EventBridge would — computes the signature from `INTERNAL_CRON_SECRET` (read
from .env) and POSTs with the X-Cron-Signature / X-Cron-Timestamp headers.
Two uses: (1) test that the cron endpoint works (expect HTTP 200 + a succeeded
refresh), and (2) run it from a scheduler (local cron or the deployed server)
for real hourly auto-refresh. Requires the API to be running.