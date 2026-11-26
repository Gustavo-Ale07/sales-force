import { Inject, Injectable } from '@nestjs/common';
import { account, device, deviceSetting, type Database } from '@salesforce/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE } from '../platform/tokens.js';
import type { AuditWriter } from './audit.service.js';

export interface DeviceRow {
  readonly id: string;
  readonly accountId: string;
  readonly installId: string;
  readonly label: string;
  readonly platform: 'android' | 'ios';
  readonly status: 'pending' | 'approved' | 'revoked';
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly lastSyncAt: Date | null;
  readonly decidedAt: Date | null;
}

export interface DeviceListRow extends DeviceRow {
  readonly accountName: string;
  readonly accountUsername: string;
  readonly accountRole: string;
  readonly decidedByName: string | null;
}

export interface DeviceSettingsRow {
  readonly offlineMaxDays: number;
  readonly maxActiveDevices: number;
}

/** Transaction handle with the verbs the device service needs. */
export type DeviceTx = Pick<Database, 'select' | 'insert' | 'update' | 'execute'> & AuditWriter;

const columns = {
  id: device.id,
  accountId: device.accountId,
  installId: device.installId,
  label: device.label,
  platform: device.platform,
  status: device.status,
  createdAt: device.createdAt,
  lastSeenAt: device.lastSeenAt,
  lastSyncAt: device.lastSyncAt,
  decidedAt: device.decidedAt,
};

function asRow<T extends { platform: string; status: string }>(row: T): T & Pick<DeviceRow, 'platform' | 'status'> {
  return row as T & Pick<DeviceRow, 'platform' | 'status'>;
}

/** Storage of `device` and `device_setting`. Owned by the identity module. */
@Injectable()
export class DeviceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: DeviceTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx as unknown as DeviceTx));
  }

  async settings(writer: Pick<Database, 'select'> = this.db): Promise<DeviceSettingsRow> {
    const [row] = await writer
      .select({ offlineMaxDays: deviceSetting.offlineMaxDays, maxActiveDevices: deviceSetting.maxActiveDevices })
      .from(deviceSetting)
      .where(eq(deviceSetting.id, 1));
    return row ?? { offlineMaxDays: 7, maxActiveDevices: 1 };
  }

  async saveSettings(values: { readonly maxActiveDevices: number }, actorAccountId: string, now: Date, writer: Pick<Database, 'insert'> = this.db): Promise<void> {
    await writer
      .insert(deviceSetting)
      .values({ id: 1, ...values, updatedAt: now, updatedBy: actorAccountId })
      .onConflictDoUpdate({ target: deviceSetting.id, set: { ...values, updatedAt: now, updatedBy: actorAccountId } });
  }

  async findByInstall(accountId: string, installId: string): Promise<DeviceRow | null> {
    const [row] = await this.db
      .select(columns)
      .from(device)
      .where(and(eq(device.accountId, accountId), eq(device.installId, installId)));
    return row === undefined ? null : asRow(row);
  }

  /** Inserts the device; a concurrent registration of the same installation is a no-op (the caller re-reads). */
  async insertIfAbsent(values: Omit<DeviceRow, 'lastSyncAt' | 'decidedAt'>, writer: Pick<Database, 'insert'> = this.db): Promise<boolean> {
    const inserted = await writer.insert(device).values(values).onConflictDoNothing().returning({ id: device.id });
    return inserted.length > 0;
  }

  async touchSeen(id: string, label: string, now: Date): Promise<void> {
    await this.db.update(device).set({ lastSeenAt: now, label }).where(eq(device.id, id));
  }

  async setLastSync(id: string, at: Date): Promise<void> {
    await this.db.update(device).set({ lastSyncAt: at }).where(eq(device.id, id));
  }

  async get(id: string, writer: Pick<Database, 'select'> = this.db): Promise<DeviceListRow | null> {
    const rows = await this.list({ id }, writer);
    return rows[0] ?? null;
  }

  async list(filter: { id?: string; status?: DeviceRow['status']; ownerRole?: string }, writer: Pick<Database, 'select'> = this.db): Promise<DeviceListRow[]> {
    const decider = alias(account, 'decider');
    const conditions = [
      filter.id === undefined ? undefined : eq(device.id, filter.id),
      filter.status === undefined ? undefined : eq(device.status, filter.status),
      filter.ownerRole === undefined ? undefined : eq(account.role, filter.ownerRole),
    ].filter((c) => c !== undefined);
    const rows = await writer
      .select({
        ...columns,
        accountName: account.displayName,
        accountUsername: account.email, // legacy column name of the login identifier
        accountRole: account.role,
        decidedByName: decider.displayName,
      })
      .from(device)
      .innerJoin(account, eq(account.id, device.accountId))
      .leftJoin(decider, eq(decider.id, device.decidedBy))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(device.createdAt));
    return rows.map(asRow);
  }

  /** Serializes the decisions about one account's devices (the approved-count limit is checked under this lock). */
  async lockAccount(accountId: string, tx: DeviceTx): Promise<void> {
    await tx.execute(sql`select 1 from ${account} where ${account.id} = ${accountId} for update`);
  }

  async countApproved(accountId: string, tx: Pick<Database, 'select'>): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(device)
      .where(and(eq(device.accountId, accountId), eq(device.status, 'approved')));
    return row?.n ?? 0;
  }

  /** Moves the status only from `from` (a lost race returns false). */
  async decide(
    id: string,
    from: DeviceRow['status'],
    to: DeviceRow['status'],
    by: string,
    now: Date,
    tx: Pick<Database, 'update'>,
  ): Promise<boolean> {
    const changed = await tx
      .update(device)
      .set({ status: to, decidedAt: now, decidedBy: by })
      .where(and(eq(device.id, id), eq(device.status, from)))
      .returning({ id: device.id });
    return changed.length > 0;
  }
}
