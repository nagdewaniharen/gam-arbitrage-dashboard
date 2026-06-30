import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import { ok } from '../lib/responses.js';

interface SiteRow {
  site: string;
}

export async function sitesRoutes(app: FastifyInstance) {
  app.get(
    '/sites',
    {
      schema: {
        tags: ['reports'],
        summary: 'Distinct site/domain values available for the filter dropdown',
      },
    },
    async () => {
      const rows = await prisma.$queryRaw<SiteRow[]>(Prisma.sql`
        SELECT DISTINCT site
        FROM gam_reports
        WHERE site <> ''
        ORDER BY site ASC
      `);
      return ok({ sites: rows.map((r) => r.site) });
    },
  );
}
