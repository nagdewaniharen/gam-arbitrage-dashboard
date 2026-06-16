import type { Dimension } from '@gam/types';
import { VALID_DIMENSIONS } from '@gam/types';

/**
 * Maps a Dimension to its actual Postgres column name (snake_case).
 * Used to safely build dynamic GROUP BY / SELECT clauses.
 */
const DIM_TO_COL: Record<Dimension, string> = {
  campaign: 'campaign',
  source: 'source',
  headline: 'headline',
  lander: 'lander',
  image: 'image',
  ad_unit: 'ad_unit',
  page: 'page',
  date: 'date',
};

export function dimColumn(d: Dimension): string {
  if (!VALID_DIMENSIONS.includes(d)) {
    throw new Error(`Invalid dimension: ${d}`);
  }
  return DIM_TO_COL[d];
}

export function isValidDimension(s: string): s is Dimension {
  return (VALID_DIMENSIONS as readonly string[]).includes(s);
}
