/**
 * Diagnostic: asks GAM's NetworkService.getAllNetworks() which networks the
 * service account currently has access to. Bypasses ReportService entirely.
 *
 * Three possible outcomes:
 *   1. Returns ≥1 network: the SA is configured; we'll see which network codes
 *      it can access (and confirm whether env.GAM_NETWORK_CODE is one of them).
 *   2. Returns 0 networks: the SA was created but never added to ANY network.
 *      → TL needs to add the SA email inside GAM Admin → Access → Users.
 *   3. Returns 401 / auth error: the JSON or scope is wrong (very unlikely).
 *
 * Run:
 *   pnpm --filter @gam/api exec tsx src/cli/diagnose-gam.ts
 */
import { GoogleAuth } from 'google-auth-library';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const GAM_API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const NETWORK_SERVICE_URL = `https://ads.google.com/apis/ads/publisher/${GAM_API_VERSION}/NetworkService`;
const SCOPE = 'https://www.googleapis.com/auth/dfp';
const APP_NAME = 'GAM Arbitrage Dashboard';

async function main() {
  const saPath =
    process.env.GAM_SERVICE_ACCOUNT_JSON_PATH ??
    path.resolve(process.cwd(), '../../secrets/gam-service-account.json');
  const buf = await fs.readFile(saPath, 'utf-8');
  const credentials = JSON.parse(buf);

  console.log('🔍 Service account:', credentials.client_email);
  console.log('🔍 Project:', credentials.project_id);
  console.log('🔍 GAM API version:', GAM_API_VERSION);
  console.log('');

  const auth = new GoogleAuth({ credentials, scopes: [SCOPE] });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const accessToken = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
  if (!accessToken) throw new Error('No access token');
  console.log('✓ Obtained access token (truncated):', accessToken.slice(0, 40) + '…');
  console.log('');

  // getAllNetworks doesn't require a network code in the header.
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="https://www.google.com/apis/ads/publisher/${GAM_API_VERSION}">
  <soap:Header>
    <ns:RequestHeader>
      <ns:applicationName>${APP_NAME}</ns:applicationName>
    </ns:RequestHeader>
  </soap:Header>
  <soap:Body>
    <ns:getAllNetworks/>
  </soap:Body>
</soap:Envelope>`;

  console.log(`→ POST ${NETWORK_SERVICE_URL}`);
  const res = await fetch(NETWORK_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: 'getAllNetworks',
      Authorization: `Bearer ${accessToken}`,
    },
    body: envelope,
  });
  const text = await res.text();
  console.log(`← HTTP ${res.status}`);
  console.log('');

  if (!res.ok || text.includes('<faultstring>')) {
    const fault = /<faultstring[^>]*>([^<]+)<\/faultstring>/.exec(text)?.[1];
    console.log('❌ FAULT:', fault ?? text.slice(0, 500));
    console.log('');
    console.log('Diagnosis:');
    if (fault?.includes('AUTHENTICATION_FAILED') || fault?.includes('NO_NETWORKS_TO_ACCESS')) {
      console.log('  → The service account is NOT a member of ANY GAM network.');
      console.log('  → Ask TL to add this email inside GAM Admin → Access → Users:');
      console.log('     ', credentials.client_email);
    } else {
      console.log('  → Unexpected fault. Share output with engineer.');
    }
    process.exit(1);
  }

  // Parse network codes + display names out of the SOAP response.
  const networkRegex = /<networkCode>([^<]+)<\/networkCode>\s*<displayName>([^<]+)<\/displayName>/g;
  const networks: { code: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = networkRegex.exec(text)) !== null) {
    networks.push({ code: m[1]!, name: m[2]! });
  }
  // Fallback: just extract codes if order differs
  if (networks.length === 0) {
    const codes = [...text.matchAll(/<networkCode>([^<]+)<\/networkCode>/g)].map((m) => m[1]!);
    const names = [...text.matchAll(/<displayName>([^<]+)<\/displayName>/g)].map((m) => m[1]!);
    for (let i = 0; i < codes.length; i++) {
      networks.push({ code: codes[i]!, name: names[i] ?? '(unknown)' });
    }
  }

  if (networks.length === 0) {
    console.log('⚠️  GAM responded OK but returned ZERO networks.');
    console.log('   → The SA email exists, but is not on any network yet.');
    console.log('   → Ask TL to add it inside GAM Admin → Access → Users.');
    process.exit(2);
  }

  const expected = process.env.GAM_NETWORK_CODE ?? '';
  console.log(`✓ Found ${networks.length} network(s) accessible by this service account:`);
  for (const n of networks) {
    const flag = expected && n.code === expected ? '  ← matches GAM_NETWORK_CODE' : '';
    console.log(`   - networkCode: ${n.code}   name: ${n.name}${flag}`);
  }
  console.log('');
  if (!expected) {
    console.log('⚠️  GAM_NETWORK_CODE env var not set — cannot verify expected network.');
    return;
  }
  const has = networks.some((n) => n.code === expected);
  if (has) {
    console.log(`✅ SA has access to ${expected} — should be able to pull reports.`);
  } else {
    console.log(`❌ SA does NOT have access to ${expected}.`);
    console.log('   → Either the network code in .env is wrong, or the SA is on a different network.');
    console.log('   → Use one of the listed networkCodes above as GAM_NETWORK_CODE.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
