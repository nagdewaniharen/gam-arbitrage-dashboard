import { Prisma } from '@gam/db';

/**
 * Parse a comma-separated `sites=a,b,c` querystring into a trimmed string[].
 * Empty/missing input → []. Whitespace-only entries are dropped.
 */
export function parseSites(raw: string | undefined): string[] {
  return parseCsvList(raw);
}

export function parseCountries(raw: string | undefined): string[] {
  return parseCsvList(raw);
}

function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build a `WHERE date ... AND site = ANY(...) AND country = ANY(...)` clause
 * for gam_reports queries. Pass `prefix: 'AND'` for callers that already
 * opened a `WHERE 1=1`.
 */
export function whereGam(opts: {
  from: Date | null;
  to: Date | null;
  sites?: string[];
  countries?: string[];
  prefix?: 'WHERE' | 'AND';
}): Prisma.Sql {
  const conds: Prisma.Sql[] = [];
  if (opts.from && opts.to) {
    conds.push(Prisma.sql`date BETWEEN ${opts.from} AND ${opts.to}`);
  } else if (opts.to) {
    conds.push(Prisma.sql`date <= ${opts.to}`);
  }
  if (opts.sites && opts.sites.length > 0) {
    conds.push(Prisma.sql`site = ANY(${opts.sites})`);
  }
  if (opts.countries && opts.countries.length > 0) {
    conds.push(Prisma.sql`country = ANY(${opts.countries})`);
  }
  if (conds.length === 0) return Prisma.empty;
  const head = Prisma.raw(opts.prefix === 'AND' ? 'AND' : 'WHERE');
  return Prisma.sql`${head} ${Prisma.join(conds, ' AND ')}`;
}
