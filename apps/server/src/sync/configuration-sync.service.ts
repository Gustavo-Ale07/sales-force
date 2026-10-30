import { syncState, type DbHandle } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { assertConfigurationFactsComplete, type SankhyaReadPort } from '@salesforce/sankhya';
import { AUDIT_ACTIONS, type AuditService } from '../iam/audit.service.js';
import { configurationContentHash } from '../configuration/configuration-hash.js';
import {
  InstallationConfigurationRepository,
  type StoredConfigurationRow,
} from '../configuration/configuration.repository.js';
import { overlayConfigurationFacts } from '../configuration/sankhya-overlay.js';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { PermanentJobError, TransientJobError } from '../worker/job-contract.js';
import { withAdvisoryLock } from './entity-lock.js';
import { describeSyncFailure, type SyncFailure } from './failure.js';

/** `sync_state.entity` of the configuration read (a distinct value, not a mirror entity). */
export const CONFIGURATION_SYNC_ENTITY = 'configuration';
/** Advisory-lock namespace (`SFCF`): the configuration sync never runs twice at once. */
export const CONFIGURATION_LOCK_NAMESPACE = 0x53464346;

const BASE_SOURCE_KIND = 'bootstrap-file';
const MAX_CHANGED_KEYS_CHARS = 1000;
/** Keys that widen or narrow what sellers can do or see: the audit records the codes added and removed (CFG-2). */
const SCOPE_KEYS = [
  'general.enabledCompanyCodes',
  'sales.eligibleOrderTopCodes',
  'sales.negotiationTypes',
  'customers.creditFeatures.showCreditLimit',
] as const;

export interface ConfigurationSyncDeps {
  readonly db: DbHandle;
  /** Read port only (SNK-1): the configuration facts are plain SELECTs. */
  readonly gateway: Pick<SankhyaReadPort, 'readConfigurationFacts'>;
  readonly audit: AuditService;
  readonly logger: Logger;
  readonly now: Clock;
}

export type ConfigurationSyncResult =
  | { readonly outcome: 'skipped_locked' }
  | { readonly outcome: 'unchanged'; readonly contentHash: string; readonly warnings: number }
  | {
      readonly outcome: 'stored';
      readonly contentHash: string;
      readonly changedKeys: readonly string[];
      readonly warnings: number;
    };

/**
 * `sync.configuration` (CFG-8, Part 2 D3): reads the Vidya configuration inside Sankhya (read-only), overlays it on
 * the latest base file version and stores the result as a new `installation_configuration_version` when the content
 * hash changed. Fail closed: ANY error leaves the current version untouched, records the cause in
 * `sync_state` (entity `configuration`, shown by the integration panel) and is rethrown.
 */
export class ConfigurationSyncService {
  private readonly repository: InstallationConfigurationRepository;

  constructor(private readonly deps: ConfigurationSyncDeps) {
    this.repository = new InstallationConfigurationRepository(deps.db.db);
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<ConfigurationSyncResult> {
    const { db, logger } = this.deps;
    const locked = await withAdvisoryLock(db.pool, CONFIGURATION_LOCK_NAMESPACE, 1, async () => {
      const startedAt = this.deps.now();
      try {
        return await this.#execute(startedAt, options.signal);
      } catch (raised) {
        const error: unknown =
          options.signal?.aborted === true && describeSyncFailure(raised).errorClass === 'unclassified'
            ? new TransientJobError('The configuration sync was cancelled before it finished.', { cause: raised })
            : raised;
        const failure = describeSyncFailure(error);
        logger.warn(
          { entity: CONFIGURATION_SYNC_ENTITY, errorClass: failure.errorClass, errorCode: failure.errorCode, retry: failure.retry },
          'configuration sync failed; the current version is unchanged',
        );
        await this.#markFailed(startedAt, failure).catch((recordError: unknown) =>
          logger.error({ ...errorLogFields(recordError) }, 'could not record the failure in sync_state'),
        );
        throw error;
      }
    });
    if (!locked.acquired) {
      logger.info({ entity: CONFIGURATION_SYNC_ENTITY }, 'configuration sync skipped: another run is in progress');
      return { outcome: 'skipped_locked' };
    }
    return locked.value;
  }

  async #execute(startedAt: Date, signal: AbortSignal | undefined): Promise<ConfigurationSyncResult> {
    const { gateway, logger } = this.deps;
    await this.#markRunning(startedAt);

    const currentRow = await this.repository.findCurrent();
    if (currentRow === null) throw new PermanentJobError('No current installation configuration exists; the base file must be loaded first.');
    const baseRow = await this.repository.findLatestBySourceKind(BASE_SOURCE_KIND);
    if (baseRow === null) {
      throw new PermanentJobError('No base configuration version (source bootstrap-file) exists; the Sankhya overlay needs one.');
    }
    const base = this.#parse(baseRow, 'base');
    const current = currentRow.id === baseRow.id ? base : this.#parse(currentRow, 'current');
    // `sales.discountAuthority` is owned by Sales Force (edited by the admin, DISC-3), never by Sankhya: it follows the
    // current version, not the older base file.
    const seeded: InstallationConfiguration =
      current.sales.discountAuthority === undefined
        ? base
        : { ...base, sales: { ...base.sales, discountAuthority: current.sales.discountAuthority } };

    const facts = await gateway.readConfigurationFacts(signal === undefined ? {} : { signal });
    assertConfigurationFactsComplete(facts);
    const overlay = overlayConfigurationFacts({ base: seeded, facts });

    const validated = validateInstallationConfiguration(structuredClone(overlay.snapshot));
    if (!validated.ok) {
      throw new PermanentJobError(`The configuration read from Sankhya is invalid: ${validated.issues.join('; ').slice(0, 400)}`);
    }
    const snapshot = validated.value as unknown as InstallationConfiguration;
    const contentHash = configurationContentHash(snapshot);
    const warnings = overlay.warnings.length;
    const changedKeys = overlay.entries.filter((entry) => entry.changed).map((entry) => entry.key);
    const finishedAt = (): Date => this.deps.now();

    if (contentHash === currentRow.contentHash) {
      await this.#markSucceeded(startedAt, finishedAt());
      logger.info(this.#report(currentRow.versionLabel, contentHash, [], overlay, 'unchanged'), 'configuration sync: nothing changed');
      return { outcome: 'unchanged', contentHash, warnings };
    }

    const now = this.deps.now();
    const stored = await this.repository.replaceCurrent({
      expectedContentHash: currentRow.contentHash,
      now,
      build: () => snapshot,
      afterStore: (writer, next) =>
        this.deps.audit.record(
          {
            action: AUDIT_ACTIONS.configSankhyaSynced,
            actorAccountId: null,
            detail: {
              previousVersion: currentRow.versionLabel,
              previousHash: currentRow.contentHash,
              newVersion: next.source.version,
              newHash: contentHash,
              baseVersion: base.source.version,
              changedCount: changedKeys.length,
              changedKeys: changedKeys.join(',').slice(0, MAX_CHANGED_KEYS_CHARS),
              warningCount: warnings,
              scopeChanges: scopeChanges(overlay.entries),
            },
          },
          writer,
        ),
    });
    if (stored.outcome === 'not_stored') throw new PermanentJobError('The current installation configuration disappeared during the sync.');
    if (stored.outcome === 'stale') {
      throw new TransientJobError('The installation configuration changed while it was being read; the next run repeats the sync.');
    }
    await this.#markSucceeded(startedAt, finishedAt());
    logger.info(this.#report(snapshot.source.version, contentHash, changedKeys, overlay, 'stored'), 'configuration sync stored a new version');
    return { outcome: 'stored', contentHash, changedKeys, warnings };
  }

  /** Report of one run: keys, codes and counts only. No values read from Sankhya, no credential-bearing text. */
  #report(
    version: string,
    contentHash: string,
    changedKeys: readonly string[],
    overlay: ReturnType<typeof overlayConfigurationFacts>,
    outcome: 'stored' | 'unchanged',
  ): Record<string, unknown> {
    return {
      entity: CONFIGURATION_SYNC_ENTITY,
      outcome,
      version,
      contentHash,
      keysRead: overlay.entries.length,
      changedKeys,
      warnings: overlay.warnings.map((warning) => ({ code: warning.code, key: warning.key })),
      productMobility: overlay.informational.productMobility,
      parametersWithoutFeature: Object.keys(overlay.informational.parametersWithoutFeature),
    };
  }

  #parse(row: StoredConfigurationRow, role: 'base' | 'current'): InstallationConfiguration {
    const result = validateInstallationConfiguration(row.payload);
    if (!result.ok) {
      throw new PermanentJobError(`The stored ${role} configuration version is invalid: ${result.issues.join('; ').slice(0, 400)}`);
    }
    return result.value as unknown as InstallationConfiguration;
  }

  async #markRunning(at: Date): Promise<void> {
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: CONFIGURATION_SYNC_ENTITY, status: 'running', lastAttemptAt: at })
      .onConflictDoUpdate({ target: syncState.entity, set: { status: 'running', lastAttemptAt: at } });
  }

  async #markSucceeded(startedAt: Date, finishedAt: Date): Promise<void> {
    const values = {
      status: 'succeeded',
      lastSuccessAt: finishedAt,
      lastAttemptAt: startedAt,
      lastFullReconcileAt: finishedAt,
      lastErrorClass: null,
      lastErrorMessage: null,
    };
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: CONFIGURATION_SYNC_ENTITY, ...values })
      .onConflictDoUpdate({ target: syncState.entity, set: values });
  }

  async #markFailed(at: Date, failure: SyncFailure): Promise<void> {
    const values = { status: 'failed', lastAttemptAt: at, lastErrorClass: failure.errorClass, lastErrorMessage: failure.message };
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: CONFIGURATION_SYNC_ENTITY, ...values })
      .onConflictDoUpdate({ target: syncState.entity, set: values });
  }
}

function codesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(typeof item === 'object' && item !== null && 'code' in item ? (item as { code: unknown }).code : item));
  }
  return value === null || value === undefined ? [] : [String(value)];
}

/** Codes added/removed per scope-relevant key (codes and flags only, never descriptions), cut to the audit limit. */
function scopeChanges(entries: readonly { key: string; previous: unknown; next: unknown; changed: boolean }[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (!entry.changed || !(SCOPE_KEYS as readonly string[]).includes(entry.key)) continue;
    const before = new Set(codesOf(entry.previous));
    const after = new Set(codesOf(entry.next));
    const added = [...after].filter((code) => !before.has(code));
    const removed = [...before].filter((code) => !after.has(code));
    parts.push(`${entry.key}:+[${added.join(',')}]-[${removed.join(',')}]`);
  }
  return parts.join(';').slice(0, MAX_CHANGED_KEYS_CHARS);
}
