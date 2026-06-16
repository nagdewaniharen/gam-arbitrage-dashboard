import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';
import type { StatusResponse } from '@gam/types';
import { ok } from '../lib/responses.js';

export async function statusRoutes(app: FastifyInstance) {
  app.get(
    '/status',
    {
      schema: {
        tags: ['health'],
        summary: 'Last refresh time, total rows, database health',
      },
    },
    async () => {
      let databaseUp = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        databaseUp = true;
      } catch {
        databaseUp = false;
      }

      const lastSuccess = await prisma.cronRun.findFirst({
        where: { job: 'gam.refresh', status: 'succeeded' },
        orderBy: { startedAt: 'desc' },
      });
      const last = await prisma.cronRun.findFirst({
        where: { job: 'gam.refresh' },
        orderBy: { startedAt: 'desc' },
      });
      const totalRows = await prisma.gamReport.count();

      const data: StatusResponse = {
        ok: databaseUp,
        lastSuccessfulCronAt: lastSuccess?.startedAt.toISOString() ?? null,
        lastCronStatus: last?.status ?? null,
        totalRows,
        databaseUp,
        buildSha: process.env.BUILD_SHA,
        generatedAt: new Date().toISOString(),
      };
      return ok(data);
    },
  );
}
