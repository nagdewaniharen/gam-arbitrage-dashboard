// @ts-nocheck
import { google } from 'googleapis';

const API_VERSION = process.env.GAM_API_VERSION ?? 'v202511';
const NS = `https://www.google.com/apis/ads/publisher/${API_VERSION}`;
const ENDPOINT = `https://ads.google.com/apis/ads/publisher/${API_VERSION}/NetworkService`;

async function main() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GAM_OAUTH_CLIENT_ID,
    process.env.GAM_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GAM_OAUTH_REFRESH_TOKEN });
  const tokenResp = await oauth2.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error('No access token — check GAM_OAUTH_* env vars.');
  console.log('Got OAuth token OK (length', token.length, ')');

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${NS}">
  <soap:Header><ns:RequestHeader><ns:applicationName>diagnostic</ns:applicationName></ns:RequestHeader></soap:Header>
  <soap:Body><ns:getAllNetworks/></soap:Body>
</soap:Envelope>`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'getAllNetworks',
      Authorization: `Bearer ${token}`,
    },
    body: envelope,
  });
  const text = await res.text();
  console.log('\nHTTP', res.status);

  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
  if (fault) {
    console.log('\nFAULT:', fault);
    return;
  }

  const codes = [...text.matchAll(/<networkCode>(\d+)<\/networkCode>/g)].map((m) => m[1]);
  const names = [...text.matchAll(/<displayName>([\s\S]*?)<\/displayName>/g)].map((m) => m[1]);
  if (codes.length === 0) {
    console.log('\nNo networks returned. Raw response:\n', text.slice(0, 1000));
  } else {
    console.log('\nThis account CAN access these networks:');
    codes.forEach((c, i) => console.log(`   networkCode=${c}  name=${names[i] ?? '(?)'}`));
  }
}

main().catch((e) => console.error('\nERROR:', e.message));