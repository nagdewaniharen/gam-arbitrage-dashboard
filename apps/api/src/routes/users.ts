import type { FastifyInstance } from 'fastify';
import { prisma } from '@gam/db';
import { ok, err } from '../lib/responses.js';

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { schema: { tags: ['admin'], summary: 'List all users' } }, async (req, reply) => {
    if (req.user && req.user.role !== 'admin') {
      return reply.code(403).send(err('FORBIDDEN', 'Admin only'));
    }
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return ok(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    );
  });

  app.patch<{
    Params: { id: string };
    Body: { role?: 'admin' | 'user'; isActive?: boolean };
  }>(
    '/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Update a user role / activation state',
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['admin', 'user'] },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (req.user && req.user.role !== 'admin') {
        return reply.code(403).send(err('FORBIDDEN', 'Admin only'));
      }
      const { role, isActive } = req.body;
      try {
        const u = await prisma.user.update({
          where: { id: req.params.id },
          data: { ...(role !== undefined ? { role } : {}), ...(isActive !== undefined ? { isActive } : {}) },
        });
        return ok({ id: u.id, email: u.email, role: u.role, isActive: u.isActive });
      } catch {
        return reply.code(404).send(err('NOT_FOUND', 'User not found'));
      }
    },
  );
}
