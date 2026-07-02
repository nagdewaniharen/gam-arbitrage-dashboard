import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@gam/db';
import { ok } from '../lib/responses.js';

interface CountryRow {
  country: string;
}

export async function countriesRoutes(app: FastifyInstance) {
  app.get(
    '/countries',
    {
      schema: {
        tags: ['reports'],
        summary: 'Distinct country values available for the filter dropdown',
      },
    },
    async () => {
      const rows = await prisma.$queryRaw<CountryRow[]>(Prisma.sql`
        SELECT DISTINCT country
        FROM gam_reports
        WHERE country <> ''
        ORDER BY country ASC
      `);
      return ok({ countries: rows.map((r) => r.country) });
    },
  );
}
