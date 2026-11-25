import type { DbHandle } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { assertConfigurationFactsComplete, type SankhyaReadPort } from '@salesforce/sankhya';
import { configurationContentHash, canonicalJson } from '../configuration/configuration-hash.js';
import { InstallationConfigurationRepository, type StoredConfigurationRow } from '../configuration/configuration.repository.js';
import { overlayConfigurationFacts } from '../configuration/sankhya-overlay.js';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { describeSyncFailure } from '../sync/failure.js';
import { diffKeyed } from './compare.js';
import { noComparison, type ConsistencyType, type TypeOutcome } from './types.js';

export interface ConfigurationConsistencyDeps {
  readonly db: DbHandle;
  /** Read port only: the configuration facts are SELECTs (CFG-8). */
  readonly gateway: Pick<SankhyaReadPort, 'readConfigurationFacts'>;
  readonly signal?: AbortSignal;
}

type ConfigurationType = Extract<ConsistencyType, 'tops' | 'negotiationTypes' | 'configuration'>;

/** The configuration keys that carry each type. Everything else the overlay changes counts under `configuration`. */
const TYPE_KEYS = {
  tops: ['sales.eligibleOrderTopCodes'],
  negotiationTypes: ['sales.negotiationTypes'],
} as const;

const BASE_SOURCE_KIND = 'bootstrap-file';

function getPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/** Items of a configuration list keyed by their code (objects with `code`) or their own value, valued by canonical JSON. */
function itemsOf(value: unknown): Map<string, string> {
  const items = new Map<string, string>();
  if (!Array.isArray(value)) return items;
  for (const item of value) {
    const key = typeof item === 'object' && item !== null && 'code' in item ? String((item as { code: unknown }).code) : String(item);
    items.set(key, canonicalJson(item));
  }
  return items;
}

function parse(row: StoredConfigurationRow): InstallationConfiguration | null {
  const result = validateInstallationConfiguration(row.payload);
  return result.ok ? (result.value as unknown as InstallationConfiguration) : null;
}

/**
 * TOPs, negotiation types (payment terms) and the rest of the Sankhya-owned configuration. The expected value is computed with
 * the SAME steps as `ConfigurationSyncService` (read the facts, overlay on the base file, keep the Force-owned discount authority,
 * anti-empty guard against the current version) but nothing is stored: it is compared with the CURRENT stored version.
 *
 * `tops` / `negotiationTypes`: missing = in Sankhya's current read, not in the current configuration; extra = in the current
 * configuration, no longer in Sankhya's read; divergent = same code, different content.
 * `configuration`: identifiers are the other keys whose Sankhya-derived value differs from the stored one (divergent).
 */
export async function verifyConfigurationType(deps: ConfigurationConsistencyDeps, type: ConfigurationType): Promise<TypeOutcome> {
  const repository = new InstallationConfigurationRepository(deps.db.db);
  const currentRow = await repository.findCurrent();
  const baseRow = await repository.findLatestBySourceKind(BASE_SOURCE_KIND);
  if (currentRow === null || baseRow === null) return noComparison('not_configured', 'no_configuration_version');
  const base = parse(baseRow);
  const current = currentRow.id === baseRow.id ? base : parse(currentRow);
  if (base === null || current === null) return noComparison('read_failed', 'stored_configuration_invalid');
  const seeded: InstallationConfiguration =
    current.sales.discountAuthority === undefined ? base : { ...base, sales: { ...base.sales, discountAuthority: current.sales.discountAuthority } };

  let expected: InstallationConfiguration;
  let changedKeys: string[];
  try {
    const facts = await deps.gateway.readConfigurationFacts(deps.signal === undefined ? {} : { signal: deps.signal });
    assertConfigurationFactsComplete(facts);
    const overlay = overlayConfigurationFacts({ base: seeded, facts, previous: current });
    const validated = validateInstallationConfiguration(structuredClone(overlay.snapshot));
    if (!validated.ok) return noComparison('read_failed', 'sankhya_configuration_invalid');
    expected = validated.value as unknown as InstallationConfiguration;
    changedKeys = overlay.entries.filter((entry) => entry.changed).map((entry) => entry.key);
  } catch (error) {
    const failure = describeSyncFailure(error);
    return noComparison('read_failed', `${failure.errorClass}:${failure.errorCode ?? 'unknown'}`);
  }

  if (type === 'configuration') {
    const handled = new Set<string>([...TYPE_KEYS.tops, ...TYPE_KEYS.negotiationTypes]);
    const differing = configurationContentHash(expected) === currentRow.contentHash ? [] : changedKeys.filter((key) => !handled.has(key));
    // A changed hash with no other key: the difference lives in the keys already reported by `tops` / `negotiationTypes`.
    return { status: 'checked', sourceCount: null, mirrorCount: null, differences: { missing: [], extra: [], divergent: [...new Set(differing)].sort() } };
  }

  const source = new Map<string, string>();
  const stored = new Map<string, { hash: string; deleted: boolean }>();
  for (const key of TYPE_KEYS[type]) {
    for (const [code, json] of itemsOf(getPath(expected, key))) source.set(code, json);
    for (const [code, json] of itemsOf(getPath(current, key))) stored.set(code, { hash: json, deleted: false });
  }
  return { status: 'checked', sourceCount: source.size, mirrorCount: stored.size, differences: diffKeyed(source, stored) };
}
