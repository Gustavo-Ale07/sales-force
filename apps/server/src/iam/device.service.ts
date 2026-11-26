import { Inject, Injectable } from '@nestjs/common';
import type { DeviceRegistration, DeviceSettings, DeviceView, SessionDevice, UpdateDeviceSettingsRequest } from '@salesforce/contracts';
import {
  canTransitionDevice,
  clampOfflineMaxDays,
  initialDeviceStatus,
  mayManageDevice,
  resolveForceConfig,
  type AccountRole,
  type DeviceStatus,
} from '@salesforce/domain';
import { pushDevice } from '@salesforce/db';
import { and, eq, isNull } from 'drizzle-orm';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { uuidv7 } from '../platform/ids.js';
import { AppError } from '../http/app-error.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import { DeviceRepository, type DeviceListRow } from './device.repository.js';

export interface DeviceActor {
  readonly accountId: string;
  readonly role: AccountRole;
}

/**
 * Team membership for the manager scope. No team entity exists yet (W-34), so the interim rule is "every account with the seller
 * role"; the coordinator swaps this for the real team when it lands. PROPOSED: AUTH-2 does not define the manager's team.
 */
export function ownerInManagerTeam(ownerRole: string): boolean {
  return ownerRole === 'seller';
}

/**
 * Device registry (AUTH-1/AUTH-2, RF-IAM-7/8): registration at the app login, approval and revocation by an administrator or
 * the manager of the team, the offline-limit setting. Rules live in `packages/domain/device`; this service orchestrates.
 */
@Injectable()
export class DeviceService {
  constructor(
    @Inject(DeviceRepository) private readonly devices: DeviceRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Finds or creates the device of an app login. A revoked device is returned as is: the caller refuses the login. A known
   * device only has its `last_seen_at` and label refreshed (its status never changes here).
   */
  async registerAtLogin(owner: DeviceActor, registration: DeviceRegistration): Promise<{ id: string; status: DeviceStatus }> {
    const now = this.clock();
    const existing = await this.devices.findByInstall(owner.accountId, registration.installId);
    if (existing !== null) {
      if (existing.status !== 'revoked') await this.devices.touchSeen(existing.id, registration.label, now);
      return { id: existing.id, status: existing.status };
    }
    const id = uuidv7(now.getTime());
    const settings = await this.devices.settings();
    let status: DeviceStatus = 'pending';
    const created = await this.devices.transaction(async (tx) => {
      // An admin device starts approved only while the account is under its approved-device limit (checked under the account lock).
      await this.devices.lockAccount(owner.accountId, tx);
      status = initialDeviceStatus(owner.role) === 'approved' && (await this.devices.countApproved(owner.accountId, tx)) < settings.maxActiveDevices ? 'approved' : 'pending';
      const inserted = await this.devices.insertIfAbsent(
        {
          id,
          accountId: owner.accountId,
          installId: registration.installId,
          label: registration.label,
          platform: registration.platform,
          status,
          createdAt: now,
          lastSeenAt: now,
        },
        tx,
      );
      if (inserted) {
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.deviceRegistered,
            actorAccountId: owner.accountId,
            detail: { deviceId: id, platform: registration.platform, status },
          },
          tx,
        );
      }
      return inserted;
    });
    if (created) return { id, status };
    // A concurrent registration of the same installation won: use its row.
    const winner = await this.devices.findByInstall(owner.accountId, registration.installId);
    if (winner === null) throw new AppError('internal_error');
    return { id: winner.id, status: winner.status };
  }

  async sessionDevice(deviceId: string, status: DeviceStatus): Promise<SessionDevice> {
    const config = resolveForceConfig(await this.mirror.forceConfigRows());
    return { id: deviceId, status, offlineMaxDays: clampOfflineMaxDays(config.daysWithoutSync), defaultPriceTableCode: config.defaultPriceTableCode };
  }

  async reportSync(deviceId: string, syncedAt: Date): Promise<void> {
    const now = this.clock();
    // A device cannot claim a synchronization in the future; the clock of the phone is not trusted beyond the server's.
    await this.devices.setLastSync(deviceId, syncedAt.getTime() > now.getTime() ? now : syncedAt);
  }

  async list(actor: DeviceActor, status: DeviceStatus | undefined): Promise<DeviceView[]> {
    const rows = await this.devices.list({
      ...(status === undefined ? {} : { status }),
      ...(actor.role === 'admin' ? {} : { ownerRole: 'seller' }),
    });
    return rows.map((row) => this.toView(actor, row));
  }

  async approve(actor: DeviceActor, deviceId: string): Promise<DeviceView> {
    return this.decide(actor, deviceId, 'approved');
  }

  async revoke(actor: DeviceActor, deviceId: string): Promise<DeviceView> {
    return this.decide(actor, deviceId, 'revoked');
  }

  /** Days without synchronizing: registered inside the ERP (AD_FORCECFG, read-only mirror); 7 when not filled in. */
  private async offlineMaxDays(): Promise<number> {
    return clampOfflineMaxDays(resolveForceConfig(await this.mirror.forceConfigRows()).daysWithoutSync);
  }

  async getSettings(): Promise<DeviceSettings> {
    const stored = await this.devices.settings();
    return { offlineMaxDays: await this.offlineMaxDays(), maxActiveDevices: stored.maxActiveDevices };
  }

  async saveSettings(actor: DeviceActor, next: UpdateDeviceSettingsRequest): Promise<DeviceSettings> {
    const now = this.clock();
    await this.devices.transaction(async (tx) => {
      const before = await this.devices.settings(tx);
      await this.devices.saveSettings(next, actor.accountId, now, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.deviceSettingsChanged,
          actorAccountId: actor.accountId,
          detail: {
            maxActiveDevices: next.maxActiveDevices,
            previousMaxActiveDevices: before.maxActiveDevices,
          },
        },
        tx,
      );
    });
    return { offlineMaxDays: await this.offlineMaxDays(), maxActiveDevices: next.maxActiveDevices };
  }

  private async decide(actor: DeviceActor, deviceId: string, to: 'approved' | 'revoked'): Promise<DeviceView> {
    const now = this.clock();
    const settings = await this.devices.settings();
    const result = await this.devices.transaction(async (tx) => {
      const row = await this.devices.get(deviceId, tx);
      // Outside the caller's scope the device does not exist (no information about other teams).
      if (row === null || !this.mayManage(actor, row)) throw new AppError('not_found');
      if (!canTransitionDevice(row.status, to)) {
        throw new AppError('conflict', {
          message: row.status === 'revoked' ? 'Este aparelho já foi revogado.' : 'Este aparelho já foi aprovado.',
        });
      }
      await this.devices.lockAccount(row.accountId, tx);
      if (to === 'approved' && (await this.devices.countApproved(row.accountId, tx)) >= settings.maxActiveDevices) {
        throw new AppError('conflict', {
          message: 'Este usuário já tem o número máximo de aparelhos aprovados. Revogue um aparelho antes de aprovar outro.',
        });
      }
      const moved = await this.devices.decide(deviceId, row.status, to, actor.accountId, now, tx);
      if (!moved) throw new AppError('conflict');
      // Push tokens are not tied to one installation: a revoked device must not keep receiving notifications, so the account's
      // tokens are switched off (the approved devices register theirs again on the next launch).
      if (to === 'revoked') {
        await tx.update(pushDevice).set({ disabledAt: now }).where(and(eq(pushDevice.accountId, row.accountId), isNull(pushDevice.disabledAt)));
      }
      await this.audit.record(
        {
          action: to === 'approved' ? AUDIT_ACTIONS.deviceApproved : AUDIT_ACTIONS.deviceRevoked,
          actorAccountId: actor.accountId,
          detail: { deviceId, ownerAccountId: row.accountId, previousStatus: row.status },
        },
        tx,
      );
      const after = await this.devices.get(deviceId, tx);
      if (after === null) throw new AppError('internal_error');
      return after;
    });
    return this.toView(actor, result);
  }

  private mayManage(actor: DeviceActor, row: DeviceListRow): boolean {
    return mayManageDevice({
      actorRole: actor.role,
      actorAccountId: actor.accountId,
      ownerAccountId: row.accountId,
      ownerInActorTeam: ownerInManagerTeam(row.accountRole),
    });
  }

  private toView(actor: DeviceActor, row: DeviceListRow): DeviceView {
    return {
      id: row.id,
      accountId: row.accountId,
      accountName: row.accountName,
      accountUsername: row.accountUsername,
      label: row.label,
      platform: row.platform,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedByName: row.decidedByName,
      canManage: this.mayManage(actor, row) && row.status !== 'revoked',
    };
  }
}
