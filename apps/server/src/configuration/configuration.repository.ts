import { Inject, Injectable } from '@nestjs/common';
import { installationConfigurationVersion, type Database } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '../platform/ids.js';
import { DATABASE } from '../platform/tokens.js';
import { configurationContentHash } from './configuration-hash.js';

export interface StoredConfigurationRow {
  readonly id: string;
  readonly versionLabel: string;
  readonly sourceKind: string;
  readonly contentHash: string;
  readonly syncedAt: Date;
  /** Untrusted until parsed with `validateInstallationConfiguration`. */
  readonly payload: unknown;
}

export interface SaveSnapshotResult {
  readonly stored: boolean;
  readonly contentHash: string;
}

/**
 * Storage of the versioned, immutable configuration snapshots (`installation_configuration_version`,
 * CFG-1). Exactly one row is current. Owned by the configuration module: other modules go through
 * `InstallationConfigurationService`.
 */
@Injectable()
export class InstallationConfigurationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findCurrent(): Promise<StoredConfigurationRow | null> {
    const [row] = await this.db
      .select()
      .from(installationConfigurationVersion)
      .where(eq(installationConfigurationVersion.isCurrent, true));
    return row ?? null;
  }

  /**
   * Stores a snapshot as the new current version, unless the current one has the same content hash
   * (no-op). Previous versions are kept (immutable history); the swap happens in one transaction.
   */
  async saveSnapshot(configuration: InstallationConfiguration, now: Date): Promise<SaveSnapshotResult> {
    const contentHash = configurationContentHash(configuration);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ contentHash: installationConfigurationVersion.contentHash })
        .from(installationConfigurationVersion)
        .where(eq(installationConfigurationVersion.isCurrent, true))
        .for('update');
      if (current?.contentHash === contentHash) return { stored: false, contentHash };

      await tx
        .update(installationConfigurationVersion)
        .set({ isCurrent: false })
        .where(eq(installationConfigurationVersion.isCurrent, true));
      await tx.insert(installationConfigurationVersion).values({
        id: uuidv7(now.getTime()),
        versionLabel: configuration.source.version,
        sourceKind: configuration.source.kind,
        payload: configuration,
        contentHash,
        syncedAt: new Date(configuration.source.syncedAt),
        isCurrent: true,
      });
      return { stored: true, contentHash };
    });
  }
}
