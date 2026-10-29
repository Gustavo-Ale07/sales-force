import { Inject, Injectable } from '@nestjs/common';
import type { DiscountLimitsResponse, UpdateDiscountLimitsRequest } from '@salesforce/contracts';
import { resolveDiscountAuthority, type InstallationConfiguration } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import type { Logger } from '../observability/logger.js';
import { CLOCK, LOGGER, type Clock } from '../platform/tokens.js';
import { InstallationConfigurationRepository, type StoredConfigurationRow } from './configuration.repository.js';
import { validateInstallationConfiguration } from './validate.js';

/**
 * W-39 (DISC-3): the admin reads and replaces the three discount limits. They live in the installation
 * configuration (`sales.discountAuthority.limits`), so a change is a new immutable snapshot, audited in the same
 * transaction, and every order records the snapshot (`config_version_id`) whose limits routed it. The limits are
 * business parameters (never cost or margin). Per-user overrides (RF-CAT-3) are NOT built (Q8): a stored
 * `userOverrides` block is carried over untouched and never edited here.
 */
@Injectable()
export class DiscountLimitsService {
  constructor(
    @Inject(InstallationConfigurationRepository) private readonly repository: InstallationConfigurationRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async get(): Promise<DiscountLimitsResponse> {
    const row = await this.repository.findCurrent();
    if (row === null) throw new AppError('installation_not_enabled');
    return this.present(row, this.parse(row));
  }

  async update(user: CurrentUser, request: UpdateDiscountLimitsRequest): Promise<DiscountLimitsResponse> {
    const resolved = resolveDiscountAuthority({ limits: request.limits });
    if (resolved === null) {
      throw new AppError('validation_failed', {
        details: { issues: [{ path: 'limits', code: 'discount_authority_limits_not_ascending' }] },
      });
    }
    const at = this.clock();
    let previous: DiscountLimitsResponse | null = null;
    const result = await this.repository.replaceCurrent({
      expectedContentHash: request.expectedRevision,
      now: at,
      build: (row) => {
        const current = this.parse(row);
        previous = this.present(row, current);
        const existing = current.sales.discountAuthority;
        return {
          ...current,
          source: { ...current.source, version: `admin-discount-limits-${at.toISOString()}`, syncedAt: at.toISOString() },
          sales: {
            ...current.sales,
            discountAuthority: {
              limits: request.limits,
              // The admin confirmed these values: they are no longer the provisional ones.
              provisional: false,
              ...(existing?.userOverrides === undefined ? {} : { userOverrides: existing.userOverrides }),
            },
          },
        };
      },
      afterStore: (writer) =>
        this.audit.record(
          {
            action: AUDIT_ACTIONS.discountLimitsChanged,
            actorAccountId: user.accountId,
            detail: {
              previousSeller: previous?.limits.seller ?? null,
              previousManager: previous?.limits.manager ?? null,
              previousDirector: previous?.limits.director ?? null,
              seller: request.limits.seller,
              manager: request.limits.manager,
              director: request.limits.director,
              wasProvisional: previous?.provisional ?? null,
            },
          },
          writer,
        ),
    });
    if (result.outcome === 'not_stored') throw new AppError('installation_not_enabled');
    if (result.outcome === 'stale') throw new AppError('version_conflict');
    return this.get();
  }

  private parse(row: StoredConfigurationRow): InstallationConfiguration {
    const result = validateInstallationConfiguration(row.payload);
    if (!result.ok) {
      this.logger.error({ issues: result.issues.slice(0, 20) }, 'stored installation configuration is invalid');
      throw new AppError('internal_error');
    }
    return result.value;
  }

  private present(row: StoredConfigurationRow, configuration: InstallationConfiguration): DiscountLimitsResponse {
    const stored = configuration.sales.discountAuthority;
    const resolved = resolveDiscountAuthority(stored);
    // A stored block that cannot be trusted refuses every discount; the screen then offers the provisional numbers
    // only as a starting point for the admin to confirm.
    const shown = resolved ?? resolveDiscountAuthority(undefined);
    if (shown === null) throw new AppError('internal_error');
    return {
      limits: shown.limits,
      provisional: resolved === null ? true : resolved.provisional,
      revision: row.contentHash,
      updatedAt: row.syncedAt.toISOString(),
    };
  }
}
