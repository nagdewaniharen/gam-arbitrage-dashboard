import type { FastifyInstance } from 'fastify';
import { parse } from 'csv-parse';
import { prisma, Prisma } from '@gam/db';
import { env } from '../config/env.js';
import { ok, err } from '../lib/responses.js';

/**
 * Accepts a GAM Reporting CSV export and upserts rows into `gam_reports`.
 * Expected columns (case-insensitive, flexible naming):
 *   date, ad_unit, campaign, source, headline, lander, image, page,
 *   impressions, clicks, revenue, ecpm, viewability, match_rate
 */
export async function uploadCsvRoutes(app: FastifyInstance) {
  app.post(
    '/upload-csv',
    {
      schema: {
        tags: ['admin'],
        summary: 'Upload a GAM Reporting CSV (multipart/form-data, field name: file)',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) {
        return reply.code(400).send(err('NO_FILE', 'No file uploaded (expected field "file")'));
      }
      const buf = await file.toBuffer();
      const raw = buf.toString('utf-8');

      const records: Record<string, string>[] = await new Promise((resolve, reject) => {
        parse(
          raw,
          {
            columns: (header: string[]) =>
              header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')),
            skip_empty_lines: true,
            trim: true,
          },
          (parseErr, rows) => (parseErr ? reject(parseErr) : resolve(rows as Record<string, string>[])),
        );
      });

      if (records.length === 0) {
        return reply.code(422).send(err('EMPTY_CSV', 'CSV contained no data rows'));
      }

      let inserted = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const row of records) {
        try {
          const dateStr = row['date'];
          if (!dateStr) throw new Error('Missing date');
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) throw new Error(`Invalid date: ${dateStr}`);

          const data = {
            networkId: env.GAM_NETWORK_CODE,
            date,
            campaign: row['campaign'] ?? '',
            source: row['source'] ?? '',
            headline: row['headline'] ?? '',
            lander: row['lander'] ?? '',
            image: row['image'] ?? '',
            adUnit: row['ad_unit'] ?? row['ad_unit_name'] ?? '',
            page: row['page'] ?? '',
            impressions: BigInt(Math.floor(Number(row['impressions'] ?? 0))),
            clicks: BigInt(Math.floor(Number(row['clicks'] ?? 0))),
            revenue: new Prisma.Decimal(row['revenue'] ?? '0'),
            ecpm: new Prisma.Decimal(row['ecpm'] ?? row['average_ecpm'] ?? '0'),
            viewability: new Prisma.Decimal(row['viewability'] ?? '0'),
            matchRate: new Prisma.Decimal(row['match_rate'] ?? '0'),
          };
          const result = await prisma.gamReport.upsert({
            where: {
              gam_reports_unique_key: {
                networkId: data.networkId,
                date: data.date,
                campaign: data.campaign,
                source: data.source,
                headline: data.headline,
                lander: data.lander,
                image: data.image,
                adUnit: data.adUnit,
                page: data.page,
              },
            },
            create: data,
            update: {
              impressions: data.impressions,
              clicks: data.clicks,
              revenue: data.revenue,
              ecpm: data.ecpm,
              viewability: data.viewability,
              matchRate: data.matchRate,
              fetchedAt: new Date(),
            },
          });
          if (result.fetchedAt.getTime() === result.fetchedAt.getTime()) inserted += 1;
          updated += 0;
        } catch (e) {
          errors.push((e as Error).message);
        }
      }

      await prisma.auditLog.create({
        data: {
          actorEmail: 'csv-upload',
          action: 'csv.upload',
          target: file.filename,
          metadata: { totalRows: records.length, inserted, updated, errorCount: errors.length },
        },
      });

      return ok({
        filename: file.filename,
        totalRows: records.length,
        inserted,
        updated,
        errorSamples: errors.slice(0, 10),
      });
    },
  );
}
