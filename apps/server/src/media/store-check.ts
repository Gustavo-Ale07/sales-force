import { readdir } from 'node:fs/promises';
import type { Database } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import { countServable } from './product-media.repository.js';

export interface StoreCheckResult {
  readonly servableRows: number;
  /** The directory is missing, unreadable or holds no object while rows say photos exist. */
  readonly suspicious: boolean;
}

/**
 * Startup sanity check of the API's photo volume: a missing or empty directory next to stored rows means the
 * volume is not mounted (or was wiped), so every photo would answer 503. It only WARNS: the API still starts
 * (photos are not critical to ordering) and never fails on it.
 */
export async function checkProductMediaStore(db: Database, directory: string, logger: Logger): Promise<StoreCheckResult> {
  let servableRows: number;
  try {
    servableRows = await countServable(db);
  } catch (error) {
    logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'product media store check skipped: could not count stored rows');
    return { servableRows: 0, suspicious: false };
  }
  if (servableRows === 0) return { servableRows, suspicious: false };
  let entries: string[] | undefined;
  try {
    entries = (await readdir(directory)).filter((name) => name !== '.tmp');
  } catch {
    entries = undefined;
  }
  const suspicious = entries === undefined || entries.length === 0;
  if (suspicious) {
    logger.warn(
      { servableRows, directoryReadable: entries !== undefined },
      'product media directory is missing or empty while product_media has stored photos: the volume may not be mounted; photos will answer 503',
    );
  }
  return { servableRows, suspicious };
}
