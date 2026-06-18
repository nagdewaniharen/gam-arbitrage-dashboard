/**
 * One-time GAM OAuth user-flow CLI.
 *
 * Why: when a service account is blocked (Pending invitation status or wrong
 * role), the dev's own Google account (which IS a real GAM user) can be used
 * instead. We do a one-time browser OAuth exchange and save the resulting
 * refresh token to `secrets/gam-user-refresh-token.json` (gitignored).
 *
 * The GAM client (services/gam-client.ts) auto-detects this file and uses it
 * in preference to the service account JSON.
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/auth-gam.ts
 *
 * Prerequisites in .env:
 *   GAM_USER_OAUTH_CLIENT_ID      ← created in GCP (Web app)
 *   GAM_USER_OAUTH_CLIENT_SECRET  ← created in GCP
 *
 * Authorized redirect URI in GCP must be: http://localhost:8765/callback
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Load .env from the monorepo root (CLI runs from apps/api/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../../.env') });
loadEnv({ path: path.resolve(__dirname, '../../.env'), override: true });

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ['https://www.googleapis.com/auth/dfp'].join(' ');
const TOKEN_OUTPUT = path.resolve(
  process.cwd(),
  '../../secrets/gam-user-refresh-token.json',
);

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

async function main() {
  const clientId = process.env.GAM_USER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GAM_USER_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      '\n❌ Missing env vars. Add to .env:\n' +
        '  GAM_USER_OAUTH_CLIENT_ID=...\n' +
        '  GAM_USER_OAUTH_CLIENT_SECRET=...\n\n' +
        'Get these from GCP Console → APIs & Services → Credentials →\n' +
        '+ Create credentials → OAuth client ID → Web application.\n' +
        `\nAuthorized redirect URI: ${REDIRECT_URI}\n`,
    );
    process.exit(1);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  console.log('\n🚀 Starting GAM OAuth user-flow setup...\n');
  console.log('1. A browser tab will open in 2 seconds.');
  console.log('2. Sign in with your GAM-authorized Google account.');
  console.log('3. Approve the requested permission (Ad Manager API).');
  console.log('4. You will be redirected back to localhost — DO NOT close the terminal.\n');

  const codePromise = waitForCode(state);

  setTimeout(() => {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then((cp) => {
      cp.spawn(opener, [authUrl.toString()], { stdio: 'ignore', detached: true }).unref();
    });
  }, 2_000);

  console.log(`If the browser doesn't open automatically, visit:\n  ${authUrl.toString()}\n`);

  const code = await codePromise;
  console.log('✓ Got authorization code; exchanging for tokens…');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error(`❌ Token exchange failed: HTTP ${tokenRes.status}\n${errBody}`);
    process.exit(1);
  }

  const tokens = (await tokenRes.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    console.error(
      '❌ Google did not return a refresh_token. This usually means you already\n' +
        '   granted access before — go to https://myaccount.google.com/permissions,\n' +
        '   remove the OAuth client, and re-run this CLI.',
    );
    process.exit(1);
  }

  await fs.mkdir(path.dirname(TOKEN_OUTPUT), { recursive: true });
  await fs.writeFile(
    TOKEN_OUTPUT,
    JSON.stringify(
      {
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        obtained_at: new Date().toISOString(),
        client_id: clientId,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  console.log(`\n✅ Refresh token saved to:\n  ${TOKEN_OUTPUT}\n`);
  console.log('You can now run the backfill:');
  console.log('  pnpm --filter @gam/api backfill --days 1\n');
  process.exit(0);
}

function waitForCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) {
        res
          .writeHead(400, { 'Content-Type': 'text/html' })
          .end(`<h1>OAuth error: ${error}</h1>You can close this tab.`);
        server.close();
        reject(new Error(error));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400).end('Invalid state');
        server.close();
        reject(new Error('state mismatch'));
        return;
      }
      if (!code) {
        res.writeHead(400).end('Missing code');
        server.close();
        reject(new Error('missing code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        `<html><body style="font-family:system-ui;padding:40px;text-align:center;background:#0b0d11;color:#e7e7ea">
          <h1 style="color:#10b981">✓ Authorization complete</h1>
          <p>You can close this tab and return to your terminal.</p>
        </body></html>`,
      );
      server.close();
      resolve(code);
    });
    server.listen(PORT, () => {
      // ready
    });
    server.on('error', reject);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
