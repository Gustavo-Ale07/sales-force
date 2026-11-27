import { Inject, Injectable } from '@nestjs/common';
import type { SessionAppConfig } from '@salesforce/contracts';
import { clampOfflineMaxDays, resolveForceConfig } from '@salesforce/domain';
import { ForceConfigRepository } from '../force-config/force-config.repository.js';

/**
 * App parameters taken from the Force configuration (edited on the site): days the app may stay without a synchronization and the
 * price table of a customer without one. Replaces the former per-device payload (no device approval exists any more).
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(ForceConfigRepository) private readonly forceConfig: ForceConfigRepository) {}

  async get(): Promise<SessionAppConfig> {
    const row = await this.forceConfig.settings();
    const config = resolveForceConfig(row === null ? null : { maxDaysWithoutSync: row.maxDaysWithoutSync, defaultPriceTableCode: row.defaultPriceTableCode });
    return { offlineMaxDays: clampOfflineMaxDays(config.daysWithoutSync), defaultPriceTableCode: config.defaultPriceTableCode };
  }
}
