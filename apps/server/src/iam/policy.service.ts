import { Inject, Injectable } from '@nestjs/common';
import {
  resolveCustomerScopeOutcome,
  type CustomerScope,
  type InstallationConfiguration,
} from '@salesforce/domain';
import { ConfigurationVersionService } from '../configuration/configuration-version.service.js';
import { InstallationConfigurationService } from '../configuration/configuration.service.js';
import { AppError } from '../http/app-error.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { CLOCK, LOGGER, type Clock } from '../platform/tokens.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import { AuditSampler } from './audit-sampler.js';
import type { CurrentUser } from './current-user.js';
import { authorizeRoute, toScopeActor, type PolicyDecision } from './policy.js';

/** What a business endpoint needs to serve one request: the rules in force and the caller's data scope. */
export interface AccessContext {
  readonly configuration: InstallationConfiguration;
  /** Id of the configuration snapshot the rules came from. */
  readonly configVersionId: string;
  readonly scope: CustomerScope;
}

/**
 * The single entry point application code uses for access decisions (AUTH-4, PROPOSED). Route
 * access comes from the pure `policy.ts`; the data scope from `resolveCustomerScopeOutcome` in the
 * domain, evaluated against the current installation configuration. Endpoints that read scoped data
 * ask `accessContext(user)` (or `customerScope(user)`) and push the scope into the query; none may
 * build its own filter.
 */
@Injectable()
export class PolicyService {
  /** Bounds the audit rows of a repeatedly refused account (a 5-minute window per account). */
  readonly #denials = new AuditSampler(5 * 60_000);

  constructor(
    @Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService,
    @Inject(ConfigurationVersionService) private readonly versions: ConfigurationVersionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  authorizeRoute(user: CurrentUser, operationId: string): PolicyDecision {
    return authorizeRoute(user, operationId);
  }

  async customerScope(user: CurrentUser): Promise<CustomerScope> {
    const { configuration } = await this.configuration.current();
    return this.scopeOrDeny(user, configuration);
  }

  /**
   * Scope plus the configuration in force for an endpoint that needs a working installation
   * (`installation_not_enabled` otherwise, CFG-3...6). The scope is resolved against the very same
   * snapshot the endpoint will apply.
   */
  async accessContext(user: CurrentUser): Promise<AccessContext> {
    const { versionId, configuration } = await this.versions.requireEnabled();
    return {
      configuration,
      configVersionId: versionId,
      scope: await this.scopeOrDeny(user, configuration),
    };
  }

  /**
   * The scope, or the refusal: a seller without a valid seller link is `no_seller_scope` (403) on every
   * scoped route, never an empty or wide scope; any other unknown role is a plain `forbidden`. The
   * refusal is audited with the account id only (sampled per account, no personal data).
   */
  private async scopeOrDeny(user: CurrentUser, configuration: InstallationConfiguration): Promise<CustomerScope> {
    const outcome = resolveCustomerScopeOutcome(toScopeActor(user), configuration);
    if (outcome.ok) return outcome.scope;
    const sample = this.#denials.observe(user.accountId, this.clock());
    if (sample.record) {
      try {
        await this.audit.record({
          action: AUDIT_ACTIONS.noSellerScope,
          actorAccountId: user.accountId,
          detail: { reason: outcome.reason, role: user.role, occurrences: sample.count },
        });
      } catch (error) {
        // Fail closed: the denial stands even when its audit row cannot be written.
        this.logger.warn({ ...errorLogFields(error), reason: outcome.reason }, 'could not record a scope denial');
      }
    }
    throw new AppError(outcome.reason === 'no_seller_scope' ? 'no_seller_scope' : 'forbidden');
  }
}
