import { Inject, Injectable } from '@nestjs/common';
import type { SellersQuery, SellersResponse } from '@salesforce/contracts';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';

/**
 * Sellers visible to the actor: everyone for scope `all`; a seller sees only the sellers linked to
 * their own account (P-21), never the whole sales force.
 */
@Injectable()
export class SellersService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
  ) {}

  async list(user: CurrentUser, query: SellersQuery): Promise<SellersResponse> {
    const { scope } = await this.policy.accessContext(user);
    const items = await this.mirror.listSellers({ scope, search: query.search, active: query.active });
    return { items };
  }
}
