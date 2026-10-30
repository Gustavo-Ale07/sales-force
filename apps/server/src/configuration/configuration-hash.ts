import { createHash } from 'node:crypto';
import { configurationHashView } from '@salesforce/contracts';
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
 * Content hash of a configuration snapshot (`sha256:<hex>`) over the contracts hash view (CFG-8): `source.syncedAt` and
 * every `provenance[*].readAt` are excluded, so reading the same configuration again never looks like a change
 * (CFG-1: hash-diff before storing).
 */
export function configurationContentHash(configuration: InstallationConfiguration): string {
  const digest = createHash('sha256')
    .update(canonicalJson(configurationHashView(configuration as never)))
    .digest('hex');
  return `sha256:${digest}`;
}
