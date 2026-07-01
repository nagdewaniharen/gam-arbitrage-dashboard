import type { FastifyInstance } from 'fastify';
import { runGamReport, lastSoapFaultXml, lastSoapRequestXml } from '../services/gam-client.js';
import * as GamClient from '../services/gam-client.js';
import { ok } from '../lib/responses.js';

/**
 * Debug endpoint — runs a known-failing site_breakdown query so operators can
 * capture the raw SOAP request + fault XML for support tickets. NOT part of
 * normal refresh flow.
 */
export async function gamDebugRoutes(app: FastifyInstance) {
  app.post('/debug/gam/site-attempt', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);

    const log = {
      info: (m: string) => app.log.info(m),
      warn: (m: string) => app.log.warn(m),
      error: (m: string) => app.log.error(m),
    };

    let attemptError: string | null = null;
    try {
      await runGamReport(
        { fromDate: from, toDate: today, columnFamily: 'site_breakdown' },
        log,
      );
    } catch (e) {
      attemptError = (e as Error).message;
    }

    // Access the module-level captured XMLs (may have been overwritten by
    // later successful calls — this endpoint is a snapshot).
    return ok({
      attemptError,
      lastSoapRequestXml: GamClient.lastSoapRequestXml ?? lastSoapRequestXml,
      lastSoapFaultXml: GamClient.lastSoapFaultXml ?? lastSoapFaultXml,
      lastCsvHeader: GamClient.lastCsvHeaderDebug?.header ?? null,
      lastCsvRow1: GamClient.lastCsvHeaderDebug?.row1 ?? null,
    });
  });
}
