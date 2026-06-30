import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { statsRoutes } from './stats.js';
import { breakdownRoutes } from './breakdown.js';
import { trendRoutes } from './trend.js';
import { crossRoutes } from './cross.js';
import { performersRoutes } from './performers.js';
import { statusRoutes } from './status.js';
import { uploadCsvRoutes } from './upload-csv.js';
import { refreshRoutes } from './refresh.js';
import { costRoiRoutes } from './cost-roi.js';
import { spendRoutes } from './spend.js';
import { internalCronRoutes } from './internal-cron.js';
import { alertRoutes } from './alerts.js';
import { compareRoutes } from './compare.js';
import { sitesRoutes } from './sites.js';
import { userRoutes } from './users.js';
import { auditRoutes } from './audit.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(statsRoutes, { prefix: '/api' });
  await app.register(breakdownRoutes, { prefix: '/api' });
  await app.register(trendRoutes, { prefix: '/api' });
  await app.register(crossRoutes, { prefix: '/api' });
  await app.register(performersRoutes, { prefix: '/api' });
  await app.register(statusRoutes, { prefix: '/api' });
  await app.register(uploadCsvRoutes, { prefix: '/api' });
  await app.register(refreshRoutes, { prefix: '/api' });
  await app.register(costRoiRoutes, { prefix: '/api' });
  await app.register(spendRoutes, { prefix: '/api' });
  await app.register(alertRoutes, { prefix: '/api' });
  await app.register(compareRoutes, { prefix: '/api' });
  await app.register(sitesRoutes, { prefix: '/api' });
  await app.register(userRoutes, { prefix: '/api' });
  await app.register(auditRoutes, { prefix: '/api' });
  await app.register(internalCronRoutes, { prefix: '/internal' });
}
