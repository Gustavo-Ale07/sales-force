import { Inject, Injectable } from '@nestjs/common';
import type { ReleaseQueueCountQuery, ReleaseQueueCountResponse, ReleaseQueueQuery, ReleaseQueueResponse } from '@salesforce/contracts';
import { normalizeDecimalString, releaseQueueSectors, resolveOrderStageRules, visibleReleaseQueueSectors } from '@salesforce/domain';
import { InstallationConfigurationService } from '../configuration/configuration.service.js';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { customerNameOrFallback } from './order.mapper.js';
import { ReleaseQueueRepository } from './release-queue.repository.js';

/**
 * Release queue ("Aguardando liberação"): read only; Sankhya releases, the Force only shows who must release what. The permission
 * `release_queue.read:<sector>` is decided by the domain (`visibleReleaseQueueSectors`) from the caller's role and the installation
 * configuration, and is pushed into the query as the sector list, so a caller never reads a sector they may not see (P-21).
 */
@Injectable()
export class ReleaseQueueService {
  constructor(
    @Inject(ReleaseQueueRepository) private readonly queue: ReleaseQueueRepository,
    @Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Sectors the caller may read, narrowed by the optional filter; 403 when there is none (deny by default). */
  private async sectorsFor(user: CurrentUser, requested: string | undefined) {
    const { configuration } = await this.configuration.current();
    const rules = resolveOrderStageRules(configuration.erp?.orderStage);
    const known = releaseQueueSectors(rules);
    const visible = visibleReleaseQueueSectors(user, known, configuration.erp?.releaseQueue?.sectorUsers);
    if (visible.length === 0) throw new AppError('forbidden');
    if (requested === undefined) return { sectors: visible, configuration };
    if (visible.includes(requested)) return { sectors: [requested], configuration };
    // A real sector the caller may not see is refused; a name that is no sector at all is simply an empty queue.
    if (known.includes(requested)) throw new AppError('forbidden');
    return { sectors: [] as string[], configuration };
  }

  async list(user: CurrentUser, query: ReleaseQueueQuery): Promise<ReleaseQueueResponse> {
    const { sectors, configuration } = await this.sectorsFor(user, query.sector);
    const { rows, total } = await this.queue.list(
      { sectors, sellerCode: query.sellerCode, assignedUserCode: query.assignedUserCode },
      { page: query.page, pageSize: query.pageSize },
    );
    const now = this.clock();
    const labels = configuration.erp?.liberationEventLabels;
    return {
      items: rows.map((row) => {
        const waitingSince = row.requestedAt ?? row.orderedAt;
        return {
          nunota: row.nunota,
          orderId: row.orderId,
          draftNumber: row.draftNumber,
          sector: row.sector,
          event: row.event,
          cascadeSequence: row.cascadeSequence,
          eventLabel: labels !== undefined && Object.hasOwn(labels, String(row.event)) ? (labels[String(row.event)] ?? null) : null,
          customerCode: row.customerCode,
          customerName: customerNameOrFallback(row.customerName, row.customerCode),
          sellerCode: row.sellerCode,
          sellerName: row.sellerName,
          estimatedTotal: normalizeDecimalString(row.estimatedTotal),
          topCode: row.topCode,
          orderedAt: row.orderedAt.toISOString(),
          waitingSince: waitingSince.toISOString(),
          waitingSinceSource: row.requestedAt === null ? ('order_time' as const) : ('sankhya_request' as const),
          waitingMinutes: Math.max(0, Math.floor((now.getTime() - waitingSince.getTime()) / 60_000)),
          firstSeenAt: row.firstSeenAt.toISOString(),
          assignedUserCode: row.assignedUserCode,
          checkedAt: row.checkedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async count(user: CurrentUser, query: ReleaseQueueCountQuery): Promise<ReleaseQueueCountResponse> {
    const { sectors } = await this.sectorsFor(user, query.sector);
    const { perSector, total, lastCheckedAt } = await this.queue.count(sectors);
    return {
      total,
      sectors: sectors.map((sector) => ({ sector, count: perSector.get(sector) ?? 0 })),
      lastCheckedAt: lastCheckedAt === null ? null : lastCheckedAt.toISOString(),
    };
  }
}
