import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';
import { ok, err } from '../lib/responses.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: number; action?: string } }>(
    '/audit-log',
    {
      schema: {
        tags: ['admin'],
        summary: 'List recent audit log entries (admin only)',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            action: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      if (req.user && req.user.role !== 'admin') {
        return reply.code(403).send(err('FORBIDDEN', 'Admin only'));
      }
      const limit = req.query.limit ?? 100;
      const where = req.query.action ? { action: { contains: req.query.action } } : undefined;
      const rows = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return ok(
        rows.map((r) => ({
          id: r.id.toString(),
          actorEmail: r.actorEmail,
          action: r.action,
          target: r.target,
          metadata: r.metadata,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    },
  );
}
