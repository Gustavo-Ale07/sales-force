import { createHash } from 'node:crypto';
import type { InstallationConfiguration } from '@salesforce/domain';

/** JSON with object keys sorted recursively: the same content always serializes identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Content hash of a configuration snapshot (`sha256:<hex>`). `source.syncedAt` is excluded: reading
 * the same configuration again must not look like a change (CFG-1: hash-diff before storing).
 */
export function configurationContentHash(configuration: InstallationConfiguration): string {
  const { source, ...rest } = configuration;
  const { syncedAt: _syncedAt, ...stableSource } = source;
  const digest = createHash('sha256')
    .update(canonicalJson({ ...rest, source: stableSource }))
    .digest('hex');
  return `sha256:${digest}`;
}
