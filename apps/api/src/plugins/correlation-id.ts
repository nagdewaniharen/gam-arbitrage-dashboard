/**
 * Correlation-ID plugin — every request gets a `x-correlation-id` header that
 * propagates into every log line via Pino's child logger. Makes debugging in
 * CloudWatch dramatically easier.
 */
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

export async function correlationIdPlugin(app: FastifyInstance) {
  app.addHook('onRequest', (req, reply, done) => {
    const incoming = req.headers['x-correlation-id'];
    const cid =
      (typeof incoming === 'string' && incoming) || crypto.randomBytes(8).toString('hex');
    req.log = req.log.child({ correlationId: cid });
    reply.header('x-correlation-id', cid);
    done();
  });
}
