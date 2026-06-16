import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env } from './config/env.js';
import { registerRoutes } from './routes/index.js';
import { correlationIdPlugin } from './plugins/correlation-id.js';
import { auditLogPlugin } from './plugins/audit-log.js';
import { authPlugin } from './plugins/auth.js';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(correlationIdPlugin);
  await app.register(authPlugin);
  await app.register(auditLogPlugin);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/internal/'),
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB CSV cap
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'GAM Arbitrage Reporting Dashboard — API',
        description: 'REST API for the GAM Arbitrage Reporting Dashboard.',
        version: '0.1.0',
      },
      servers: [{ url: env.PUBLIC_API_URL }],
      tags: [
        { name: 'reports', description: 'Read endpoints — KPIs, breakdowns, trend' },
        { name: 'admin', description: 'Mutating endpoints — CSV upload, manual refresh, spend' },
        { name: 'health', description: 'Health & status' },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  await registerRoutes(app);

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`API listening on ${env.API_HOST}:${env.API_PORT}`);
    app.log.info(`Swagger UI: ${env.PUBLIC_API_URL}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
