import { Inject, Injectable } from '@nestjs/common';
import {
  resolveCustomerScope,
  type CustomerScope,
  type InstallationConfiguration,
} from '@salesforce/domain';
import { ConfigurationVersionService } from '../configuration/configuration-version.service.js';
import { InstallationConfigurationService } from '../configuration/configuration.service.js';
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
 * access comes from the pure `policy.ts`; the data scope from `resolveCustomerScope` in the domain,
 * evaluated against the current installation configuration. Endpoints that read scoped data ask
 * `accessContext(user)` (or `customerScope(user)`) and push the scope into the query; none may build
 * its own filter.
 */
@Injectable()
export class PolicyService {
  constructor(
    @Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService,
    @Inject(ConfigurationVersionService) private readonly versions: ConfigurationVersionService,
  ) {}

  authorizeRoute(user: CurrentUser, operationId: string): PolicyDecision {
    return authorizeRoute(user, operationId);
  }

  async customerScope(user: CurrentUser): Promise<CustomerScope> {
    const { configuration } = await this.configuration.current();
    return resolveCustomerScope(toScopeActor(user), configuration);
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
      scope: resolveCustomerScope(toScopeActor(user), configuration),
    };
  }
}
