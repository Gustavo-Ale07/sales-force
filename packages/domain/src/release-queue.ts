import { parseDirectoryUserCode } from './directory-seller.js';
import type { OrderStageRules } from './order-stage.js';

/**
 * Who sees which sector of the release queue ("Aguardando liberação", docs/implementation/release-queue.md). New permission
 * `release_queue.read:<sector>`, DENIED BY DEFAULT: admin and manager see every sector (owner decision 2026-11-23); the internal
 * `operations` profile (owner ruling 2026-11-23, option A) sees only the sectors that installation configuration lists its Sankhya
 * user code under (`erp.releaseQueue.sectorUsers`). A seller NEVER has it, even when its user code is listed (owner ruling
 * 2026-11-23); `technical` never has it. Pure: sectors and mapping are inputs, nothing is a literal.
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
  if (actor.role !== 'operations') return [];
  const userCode = actor.externalUserId === null || actor.externalUserId === undefined ? null : parseDirectoryUserCode(actor.externalUserId);
  if (userCode === null || sectorUsers === undefined) return [];
  return sectors.filter((sector) => Object.hasOwn(sectorUsers, sector) && (sectorUsers[sector] ?? []).includes(userCode));
}
