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

---

## get-refresh-token.ts
Generates `GAM_OAUTH_REFRESH_TOKEN`. Run once (or again only if the token
expires/is revoked). Opens a Google login (https://admanager.google.com/)
-> approve with a GAM-enabled account -> prints the refresh token to paste
into `.env`.

## check-gam-access.ts
Diagnostic: "do my GAM credentials have access to any network?" Calls
`getAllNetworks` and prints accessible networks (or the error). Tells you
whether a problem is an access issue vs. a code issue.

## gam-probe.ts
Diagnostic: "which report columns return data for this network?" Runs several
test report queries (TOTAL_AD_EXCHANGE, TOTAL_LINE_ITEM_LEVEL,
AD_EXCHANGE_LINE_ITEM_LEVEL, TOTAL_IMPRESSIONS) for the last 30 days and prints
the row count + first lines of each. Use it when /api/refresh succeeds but
returns 0 rows, to find which columns/dimensions actually hold the data.