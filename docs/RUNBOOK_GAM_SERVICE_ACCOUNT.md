# Runbook — Provisioning the GAM Service Account

> **Audience**: the GAM admin (project TL). Hand this whole document to them.
> **Time**: ~15 minutes.
> **Outcome**: a single `.json` file we use to authenticate the dashboard against the Google Ad Manager Reporting API.

---

## Why this is needed

The GAM Arbitrage Dashboard automates the hourly pull of revenue, impressions, eCPM, and 7 custom dimensions from GAM. To do that without a human in the loop, GAM (Google) requires a **service account** — a special non-human Google identity that authenticates server-to-server.

Service accounts are created inside **Google Cloud Console** (a GCP project), then their email is added inside the **GAM Admin** with the **Reporting** role. That JSON file is the only credential we need.

---

## Pre-flight checklist

Before you start, confirm:

- [ ] You have an active **Google account** that is **already an admin in GAM** for network `23340025403` (River Five Global).
- [ ] That same Google account can sign in at `console.cloud.google.com`.
- [ ] You have a **secure way to share** the resulting JSON file with the dev team (1Password, Bitwarden Send, encrypted Signal — **not plain email or Slack**).

---

## Step 1 — Create a GCP project (3 min)

1. Open https://console.cloud.google.com.
2. Sign in with the Google account that admins GAM.
3. At the top of the page, click the **project dropdown** (it usually says "Select a project" or shows the current project name).
4. In the dialog that opens, click **NEW PROJECT** (top-right).
5. Fill in:
   - **Project name**: `gam-arbitrage-prod`
   - **Organization** / **Location**: leave the defaults (or your organization if shown).
6. Click **CREATE**. Wait a few seconds for the project to be ready.
7. Make sure the project dropdown at the top now shows `gam-arbitrage-prod`.

## Step 2 — Enable the Google Ad Manager API (2 min)

1. In the top search bar, type **`Google Ad Manager API`** and select the matching result (a page titled "Google Ad Manager API").
2. Click the blue **ENABLE** button.
3. Wait ~10 seconds. The page should change to show metrics/usage panels.

## Step 3 — Create the service account (3 min)

1. In the left menu, navigate to **IAM & Admin → Service Accounts**.
2. Click **+ CREATE SERVICE ACCOUNT** (top of the page).
3. Fill in:
   - **Service account name**: `gam-reporter`
   - **Service account ID**: leave as auto-filled.
   - **Description**: "Pulls hourly reports from GAM for the Arbitrage Dashboard".
4. Click **CREATE AND CONTINUE**.
5. On the "Grant this service account access to the project" step, **click CONTINUE without selecting any roles**. We do not grant any GCP roles. (We grant GAM roles in Step 5.)
6. On the "Grant users access" step, **click DONE** without filling anything.

You should now see `gam-reporter@gam-arbitrage-prod-xxxxx.iam.gserviceaccount.com` in the list. Click it.

## Step 4 — Download the JSON key (1 min)

1. On the service account page, go to the **KEYS** tab.
2. Click **ADD KEY → Create new key**.
3. Choose **JSON** and click **CREATE**.
4. A `.json` file (e.g. `gam-arbitrage-prod-xxxxx-abcd.json`) downloads to your computer.

**This is the credential. Treat it like a password.**

- ✅ Store it in 1Password / Bitwarden Send / encrypted Signal.
- ❌ Do **not** email it.
- ❌ Do **not** paste it in Slack.
- ❌ Do **not** commit it to git.
- ❌ Do **not** upload it to Google Drive without restricting access.

## Step 5 — Authorize the service account inside GAM (3 min)

1. Open the JSON file in a plain text editor.
2. Find the `"client_email"` field. It looks like:
   `gam-reporter@gam-arbitrage-prod-xxxxx.iam.gserviceaccount.com`.
   **Copy this email.**

3. Open https://admanager.google.com and sign in as the GAM admin.
4. In the left sidebar, go to **Admin → Access & authorization → Users**.
5. Click **+ Add user**.
6. Fill in:
   - **Email**: paste the service account email from step 5.2.
   - **Name**: `GAM Reporter (Dashboard)`
   - **Role**: choose **Reporting** (or any role that includes "View reports"). If your team has a custom role for read-only reporting, that works too.
   - **Email notifications**: off.
7. Click **Save**.

You may see a warning that the email "doesn't look like a typical Google account". That's expected — service-account emails always look that way. Click confirm/accept.

## Step 6 — Hand off (1 min)

Send the dev team:

1. The **JSON file** (via 1Password / Bitwarden Send).
2. The **GAM Network Code** (confirm this is `23340025403` for River Five Global).

That's it. We'll do the rest.

---

## Validation we'll run on our end

Once we receive the JSON, the dev team will:

1. Drop it into AWS Secrets Manager under `gam-arbitrage/gcp-service-account`.
2. Run a one-shot test pull against the last 24 hours.
3. Confirm rows land in our `gam_reports` table.
4. Enable the EventBridge hourly schedule.

If anything fails (most often: missing API enablement, or the SA email not added to GAM), we'll come back with a specific error message and ask you to re-check one step.

---

## What can go wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Google Ad Manager API has not been used" | Step 2 not done | Re-enable the API on the same GCP project. |
| `PERMISSION_DENIED` on report queries | Step 5 not done, or wrong role | Add SA email to GAM with a role that includes "View reports". |
| `invalid_grant` at token exchange | Wrong JSON, or JSON edited | Generate a new key in Step 4 and re-share. |
| Network code mismatch | Reports pulled from wrong network | Confirm GAM network code is `23340025403` and not a sandbox. |

---

## If you ever need to rotate the key

1. Go back to **IAM & Admin → Service Accounts → gam-reporter → KEYS**.
2. **ADD KEY → Create new key → JSON**.
3. Send the new JSON to the dev team.
4. Once they confirm the new key works, delete the old key from the same page.

---

## If you ever need to revoke access entirely

- **From GAM** (revokes reporting access but preserves the GCP identity):
  Admin → Access & authorization → Users → find `gam-reporter@…` → Delete.
- **From GCP** (kills the identity itself):
  IAM & Admin → Service Accounts → `gam-reporter` → Delete.

Either action takes effect within 5 minutes.

---

## Questions?

Reply to the dev team in the original handoff thread with screenshots of any error you hit. We'll diagnose quickly.
