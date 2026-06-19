/**
 * One-time GAM refresh-token generator (loopback method).
 * Run only if GAM_OAUTH_REFRESH_TOKEN expires/is revoked.
 *
 * From this scripts/ folder:
 *   node --env-file=../.env --experimental-strip-types get-refresh-token.ts
 * Log in with a GAM-enabled account, approve, copy the printed token into .env.
 */
import { google } from 'googleapis';
import http from 'node:http';

const CLIENT_ID = process.env.GAM_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GAM_OAUTH_CLIENT_SECRET;
const SCOPE = 'https://www.googleapis.com/auth/dfp';
const PORT = 3399;
const REDIRECT = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GAM_OAUTH_CLIENT_ID and GAM_OAUTH_CLIENT_SECRET first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [SCOPE],
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '', REDIRECT);
    const code = url.searchParams.get('code');
    if (!code) { res.end('No code received.'); return; }
    const { tokens } = await oauth2.getToken(code);
    res.end('Success! Close this tab and return to the terminal.');
    if (tokens.refresh_token) {
      console.log('\nSUCCESS. Add this to your .env:\n');
      console.log('GAM_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    } else {
      console.error('\nNo refresh_token. Revoke prior access at myaccount.google.com and re-run.\n');
    }
  } catch (e) {
    res.end('Error: ' + (e as Error).message);
    console.error('\nERROR:', (e as Error).message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('\n1) Open this URL and log in with the GAM-enabled account:\n');
  console.log(authUrl);
  console.log(`\n2) After you approve, the token is captured automatically. Waiting on ${REDIRECT} ...\n`);
});
