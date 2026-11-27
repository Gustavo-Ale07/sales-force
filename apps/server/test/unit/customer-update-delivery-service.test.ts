import { FakeGateway, FakePartnerBook, SankhyaGatewayError, type PartnerWriteRequest } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/integration/order-delivery.policy.js';
import { CustomerUpdateDeliveryService, editApplied } from '../../src/integration/customer-update-delivery.service.js';
import type {
  ClaimedCustomerUpdate,
  CustomerUpdateConfirmation,
  CustomerUpdateDeliveryStore,
  CustomerUpdateFailureRecord,
} from '../../src/integration/customer-update-delivery.store.js';

const START = new Date('2026-11-25T12:00:00Z');

const PARTNER: PartnerWriteRequest = {
  originField: 'AD_FORCEORIGEM',
  originKey: 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ab',
  document: '11222333000181',
  personType: 'company',
  name: 'Cliente Teste Ltda',
  tradeName: null,
  icmsClassification: 'R',
  stateRegistration: null,
  sellerCode: 7,
  priceTableCode: null,
  phone: '1130000000',
  email: 'antigo@example.com',
  notes: null,
  addresses: [],
};

interface Row {
  claimed: ClaimedCustomerUpdate;
  status: 'pending' | 'unknown' | 'processing' | 'confirmed' | 'rejected';
  nextAttemptAt: Date | null;
  attempts: number;
}

class MemoryStore implements CustomerUpdateDeliveryStore {
  readonly rows: Row[] = [];
  readonly confirmations: CustomerUpdateConfirmation[] = [];
  readonly failures: CustomerUpdateFailureRecord[] = [];

  add(payload: unknown): Row {
    const row: Row = {
      claimed: { outboxId: `ob-${this.rows.length + 1}`, updateId: `up-${this.rows.length + 1}`, payload, attemptCount: 0, previousStatus: 'pending' },
      status: 'pending',
      nextAttemptAt: START,
      attempts: 0,
    };
    this.rows.push(row);
    return row;
  }

  recoverStale(): Promise<number> {
    return Promise.resolve(0);
  }

  claimNext(now: Date): Promise<ClaimedCustomerUpdate | null> {
    const row = this.rows.find((r) => (r.status === 'pending' || r.status === 'unknown') && r.nextAttemptAt !== null && r.nextAttemptAt <= now);
    if (row === undefined) return Promise.resolve(null);
    const previousStatus = row.status === 'unknown' ? 'unknown' : 'pending';
    row.status = 'processing';
    row.attempts += 1;
    return Promise.resolve({ ...row.claimed, attemptCount: row.attempts, previousStatus });
  }

  markSending(): Promise<void> {
    return Promise.resolve();
  }

  confirm(input: CustomerUpdateConfirmation): Promise<void> {
    this.confirmations.push(input);
    const row = this.rows.find((r) => r.claimed.outboxId === input.claimed.outboxId);
    if (row !== undefined) Object.assign(row, { status: 'confirmed', nextAttemptAt: null });
    return Promise.resolve();
  }

  fail(input: CustomerUpdateFailureRecord): Promise<void> {
    this.failures.push(input);
    const row = this.rows.find((r) => r.claimed.outboxId === input.claimed.outboxId);
    if (row !== undefined) {
      row.status = input.status;
      row.nextAttemptAt = input.nextAttemptAt;
      if (!input.consumesAttempt) row.attempts = Math.max(0, row.attempts - 1);
    }
    return Promise.resolve();
  }
}

function build() {
  const partners = new FakePartnerBook();
  const code = partners.seed(PARTNER);
  const gateway = new FakeGateway({ partners });
  const store = new MemoryStore();
  let now = START.getTime();
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const service = new CustomerUpdateDeliveryService({ store, gateway, logger: logger as never, now: () => new Date(now) });
  return { service, store, partners, code, advance: (ms: number) => { now += ms; } };
}

const unavailable = () => new SankhyaGatewayError('unavailable', { code: 'timeout', message: 'timeout' });

describe('CustomerUpdateDeliveryService (D-AP)', () => {
  it('writes the edit once, rereads and confirms with the stored values', async () => {
    const { service, store, partners, code } = build();
    store.add({ customerCode: code, changes: { phone: '1199998888', notes: 'Obs' } });
    await service.runDue();
    expect(partners.count('update')).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: 'confirmed' });
    expect(store.confirmations[0]?.fields).toMatchObject({ phone: '1199998888', notes: 'Obs', email: 'antigo@example.com' });
  });

  it('does not write again when the ERP already holds the asked values (SNK-4 for edits)', async () => {
    const { service, store, partners, code } = build();
    store.add({ customerCode: code, changes: { email: 'antigo@example.com' } });
    await service.runDue();
    expect(partners.count('update')).toBe(0);
    expect(store.rows[0]).toMatchObject({ status: 'confirmed' });
  });

  it('after a lost answer rereads and confirms without a second write', async () => {
    const { service, store, partners, code, advance } = build();
    partners.script('update', { kind: 'created_then_error', error: unavailable() });
    store.add({ customerCode: code, changes: { phone: '1177776666' } });
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'unknown' });
    advance(20 * 60_000);
    await service.runDue();
    expect(partners.count('update')).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: 'confirmed' });
  });

  it('retries a temporary failure before the write as pending', async () => {
    const { service, store, partners, code } = build();
    partners.script('read', { kind: 'error', error: unavailable() });
    store.add({ customerCode: code, changes: { phone: '1166665555' } });
    await service.runDue();
    expect(store.failures[0]).toMatchObject({ kind: 'retry', status: 'pending' });
    expect(partners.count('update')).toBe(0);
  });

  it('a permanent ERP refusal is final (rejected) and shows the adapter reason', async () => {
    const { service, store, partners, code } = build();
    partners.script('update', { kind: 'error', error: new SankhyaGatewayError('validation', { code: 'erp_refused', message: 'The ERP refused the partner: telefone inválido.' }) });
    store.add({ customerCode: code, changes: { phone: '1100000000' } });
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'rejected' });
    expect(store.failures[0]?.message).toContain('telefone inválido');
  });

  it('exhausted retries never become a rejection', async () => {
    const { service, store, partners, code, advance } = build();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 1; i += 1) partners.script('read', { kind: 'error', error: unavailable() });
    store.add({ customerCode: code, changes: { phone: '1155554444' } });
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 1; i += 1) {
      await service.runDue();
      advance(20 * 60_000);
    }
    expect(store.rows[0]?.status).not.toBe('rejected');
    expect(store.rows[0]?.nextAttemptAt).not.toBeNull();
    expect(partners.count('update')).toBe(0);
  });

  it('a customer absent from the ERP is rejected', async () => {
    const { service, store } = build();
    store.add({ customerCode: 123456789, changes: { phone: '1144443333' } });
    await service.runDue();
    expect(store.failures[0]).toMatchObject({ kind: 'reject', errorCode: 'partner_not_found' });
  });

  it('an invalid stored command (a field with no ERP mapping) is rejected without calling the ERP', async () => {
    const { service, store, partners, code } = build();
    store.add({ customerCode: code, changes: { addresses: [] } });
    await service.runDue();
    expect(partners.calls).toHaveLength(0);
    expect(store.failures[0]).toMatchObject({ kind: 'reject', errorCode: 'invalid_command' });
  });

  it('editApplied treats an empty value as null', () => {
    expect(editApplied({ notes: null }, { phone: null, email: null, notes: '', priceTableCode: 5 })).toBe(true);
    expect(editApplied({ phone: '1' }, { phone: '2', email: null, notes: null, priceTableCode: 5 })).toBe(false);
  });
});
