import { Inject, Injectable } from '@nestjs/common';
import { resolveCustomerScope, type CustomerScope } from '@salesforce/domain';
import { InstallationConfigurationService } from '../configuration/configuration.service.js';
import type { CurrentUser } from './current-user.js';
import { authorizeRoute, toScopeActor, type PolicyDecision } from './policy.js';

/**
 * The single entry point application code uses for access decisions (AUTH-4, PROPOSED). Route
 * access comes from the pure `policy.ts`; the data scope from `resolveCustomerScope` in the domain,
 * evaluated against the current installation configuration. Endpoints that read scoped data ask
 * `customerScope(user)` and push it into the query; none may build its own filter.
 */
@Injectable()
export class PolicyService {
  constructor(@Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService) {}

  authorizeRoute(user: CurrentUser, operationId: string): PolicyDecision {
    return authorizeRoute(user, operationId);
  }

  async customerScope(user: CurrentUser): Promise<CustomerScope> {
    const { configuration } = await this.configuration.current();
    return resolveCustomerScope(toScopeActor(user), configuration);
  }
}
