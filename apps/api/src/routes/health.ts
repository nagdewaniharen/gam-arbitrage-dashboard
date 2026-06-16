import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/api/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness + DB readiness probe',
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              uptime: { type: 'number' },
              databaseUp: { type: 'boolean' },
            },
          },
        },
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
      return { ok: databaseUp, uptime: process.uptime(), databaseUp };
    },
  );
}
