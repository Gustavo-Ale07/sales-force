import { parseDirectoryUserCode } from './directory-seller.js';
import type { OrderStageRules } from './order-stage.js';

/**
 * Who sees which sector of the release queue ("Aguardando liberação", docs/implementation/release-queue.md). New permission
 * `release_queue.read:<sector>`, DENIED BY DEFAULT: only admin and manager (owner decision 2026-11-23) have it without
 * configuration; any other account has it only for the sectors that installation configuration lists its Sankhya user code
 * under (`erp.releaseQueue.sectorUsers`). `technical` never has it. Pure: sectors and mapping are inputs, nothing is a literal.
 */
export interface ReleaseQueueActor {
  readonly role: string;
  /** `account.external_user_id` = the Sankhya user code (CODUSU) as text; null/absent for a local account. */
  readonly externalUserId?: string | null;
}

/** The sectors the release queue knows: the review and financial sectors of the order stage rules. */
export function releaseQueueSectors(rules: Pick<OrderStageRules, 'reviewSector' | 'financialSector'>): readonly string[] {
  return rules.reviewSector === rules.financialSector ? [rules.reviewSector] : [rules.reviewSector, rules.financialSector];
}

export function visibleReleaseQueueSectors(
  actor: ReleaseQueueActor,
  sectors: readonly string[],
  sectorUsers: Readonly<Record<string, readonly number[]>> | undefined,
): readonly string[] {
  if (actor.role === 'admin' || actor.role === 'manager') return sectors;
  if (actor.role !== 'seller') return [];
  const userCode = actor.externalUserId === null || actor.externalUserId === undefined ? null : parseDirectoryUserCode(actor.externalUserId);
  if (userCode === null || sectorUsers === undefined) return [];
  return sectors.filter((sector) => Object.hasOwn(sectorUsers, sector) && (sectorUsers[sector] ?? []).includes(userCode));
}
