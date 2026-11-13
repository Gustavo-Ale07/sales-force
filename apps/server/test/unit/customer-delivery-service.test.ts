import { FakeGateway, FakePartnerBook, SankhyaGatewayError } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import {
  CustomerDeliveryService,
  type CustomerUpsertCommand,
} from '../../src/integration/customer-delivery.service.js';
import type {
  ClaimedCustomerCommand,
  CustomerConfirmation,
  CustomerDeliveryStore,
  CustomerFailureRecord,
} from '../../src/integration/customer-delivery.store.js';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/integration/order-delivery.policy.js';

const ID = '0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const ORIGIN = `force:${ID}`;
const START = new Date('2026-11-13T12:00:00Z');
const SETTINGS = { originField: 'AD_FORCEORIGEM', priceTableCode: 5 } as const;

const COMMAND: CustomerUpsertCommand = {
  version: 1,
  originKey: ORIGIN,
  document: '11222333000181',
  personType: 'company',
  name: 'Cliente Teste Ltda',
  tradeName: null,
  icmsClassification: 'R',
  stateRegistration: null,
  sellerCode: 7,
  phone: null,
  email: null,
  notes: null,
  addresses: [],
};

interface Row {
  claimed: ClaimedCustomerCommand;
  status: 'pending' | 'unknown' | 'processing' | 'confirmed' | 'rejected';
  nextAttemptAt: Date | null;
  registration: 'pending' | 'unknown' | 'confirmed' | 'rejected';
  rejectionCode: string | null;
  erpReference: string | null;
  attempts: number;
}

/** In-memory store with the same claim/record semantics as the Drizzle one (one row, no SQL). */
class MemoryStore implements CustomerDeliveryStore {
  readonly rows: Row[] = [];
  readonly confirmations: CustomerConfirmation[] = [];
  readonly failures: CustomerFailureRecord[] = [];
  sendingMarks = 0;

  add(payload: unknown = COMMAND, registration: Row['registration'] = 'pending'): Row {
    const row: Row = {
      claimed: {
        outboxId: `ob-${this.rows.length + 1}`,
        registrationId: `reg-${this.rows.length + 1}`,
        originKey: ORIGIN,
        payload,
        attemptCount: 0,
        previousStatus: 'pending',
        erpReference: null,
        registrationStatus: registration,
      },
      status: 'pending',
      nextAttemptAt: START,
      registration,
      rejectionCode: null,
      erpReference: null,
      attempts: 0,
    };
    this.rows.push(row);
    return row;
  }

  recoverStale(): Promise<number> {
    return Promise.resolve(0);
  }

  claimNext(now: Date): Promise<ClaimedCustomerCommand | null> {
    const row = this.rows.find((r) => (r.status === 'pending' || r.status === 'unknown') && r.nextAttemptAt !== null && r.nextAttemptAt <= now);
    if (row === undefined) return Promise.resolve(null);
    const previousStatus = row.status === 'unknown' ? 'unknown' : 'pending';
    row.status = 'processing';
    row.attempts += 1;
    return Promise.resolve({ ...row.claimed, attemptCount: row.attempts, previousStatus, erpReference: row.erpReference, registrationStatus: row.registration });
  }

  markSending(): Promise<void> {
    this.sendingMarks += 1;
    return Promise.resolve();
  }

  confirm(input: CustomerConfirmation): Promise<void> {
    this.confirmations.push(input);
    const row = this.rows.find((r) => r.claimed.outboxId === input.claimed.outboxId);
    if (row !== undefined) Object.assign(row, { status: 'confirmed', registration: 'confirmed', erpReference: String(input.erpCode), nextAttemptAt: null });
    return Promise.resolve();
  }

  fail(input: CustomerFailureRecord): Promise<void> {
    this.failures.push(input);
    const row = this.rows.find((r) => r.claimed.outboxId === input.claimed.outboxId);
    if (row !== undefined) {
      row.status = input.status;
      row.nextAttemptAt = input.nextAttemptAt;
      if (!input.consumesAttempt) row.attempts = Math.max(0, row.attempts - 1);
      if (input.erpCode !== undefined) row.erpReference = String(input.erpCode);
      if (input.kind === 'reject') Object.assign(row, { registration: 'rejected', rejectionCode: input.errorCode });
      if (input.kind === 'park') row.registration = 'unknown';
    }
    return Promise.resolve();
  }
}

function build() {
  const partners = new FakePartnerBook();
  const gateway = new FakeGateway({ partners });
  const store = new MemoryStore();
  let now = START.getTime();
  const logs: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (_o: unknown, message?: string) => void logs.push(message ?? ''),
    error: (_o: unknown, message?: string) => void logs.push(message ?? ''),
  };
  const service = new CustomerDeliveryService({
    store,
    gateway,
    settings: SETTINGS,
    logger: logger as never,
    now: () => new Date(now),
  });
  return { service, store, partners, advance: (ms: number) => { now += ms; }, logs };
}

const unavailable = () => new SankhyaGatewayError('unavailable', { code: 'timeout', message: 'timeout' });

describe('CustomerDeliveryService', () => {
  it('verifies origin and document, writes once, rereads and confirms with the real code', async () => {
    const { service, store, partners } = build();
    store.add();
    expect(await service.runDue()).toMatchObject({ processed: 1 });
    expect(partners.count('upsert')).toBe(1);
    expect(partners.partners).toHaveLength(1);
    expect(store.confirmations).toHaveLength(1);
    expect(store.confirmations[0]).toMatchObject({ erpCode: partners.partners[0]?.code });
    expect(store.rows[0]).toMatchObject({ status: 'confirmed', registration: 'confirmed' });
    expect(partners.partners[0]?.request).toMatchObject({ originField: 'AD_FORCEORIGEM', originKey: ORIGIN, priceTableCode: 5, sellerCode: 7 });
  });

  it('never sends the credit limit, partner type, region or billing-slip type', async () => {
    const { service, store, partners } = build();
    store.add();
    await service.runDue();
    const keys = Object.keys(partners.partners[0]?.request ?? {});
    for (const forbidden of ['creditLimit', 'limcred', 'partnerType', 'codtipparc', 'region', 'codreg', 'tipogerboleto']) {
      expect(keys.map((k) => k.toLowerCase())).not.toContain(forbidden);
    }
  });

  it('adopts a partner that already carries the origin: no second write', async () => {
    const { service, store, partners } = build();
    const code = partners.seed({ ...COMMAND, originField: SETTINGS.originField, priceTableCode: 5, tradeName: null } as never);
    store.add();
    await service.runDue();
    expect(partners.count('upsert')).toBe(0);
    expect(partners.partners).toHaveLength(1);
    expect(store.confirmations[0]).toMatchObject({ erpCode: code });
  });

  it('refuses a document already taken by another partner: rejected for good, nothing written', async () => {
    const { service, store, partners, advance } = build();
    partners.seed({ ...COMMAND, originKey: 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ff', originField: SETTINGS.originField, priceTableCode: 5 } as never);
    store.add();
    await service.runDue();
    expect(partners.count('upsert')).toBe(0);
    expect(store.rows[0]).toMatchObject({ status: 'rejected', registration: 'rejected', rejectionCode: 'partner_document_duplicate' });
    advance(3_600_000);
    expect((await service.runDue()).processed).toBe(0);
  });

  it('a lost answer after the ERP created the partner is re-verified by origin, never written twice', async () => {
    const { service, store, partners, advance } = build();
    partners.script('upsert', { kind: 'created_then_error', error: unavailable() });
    store.add();
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'unknown', registration: 'pending' });
    expect(partners.partners).toHaveLength(1);
    advance(10 * 60_000);
    await service.runDue();
    expect(partners.count('upsert')).toBe(1);
    expect(partners.partners).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'confirmed', registration: 'confirmed' });
  });

  it('a business refusal at the include is final and is not retried', async () => {
    const { service, store, partners, advance } = build();
    partners.script('upsert', { kind: 'error', error: new SankhyaGatewayError('validation', { code: 'partner_invalid', message: 'refused' }) });
    store.add();
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'rejected', registration: 'rejected', rejectionCode: 'partner_invalid' });
    advance(3_600_000);
    await service.runDue();
    expect(partners.count('upsert')).toBe(1);
  });

  it('an unavailable ERP before the write is retried later with backoff and no partner exists meanwhile', async () => {
    const { service, store, partners, advance } = build();
    partners.script('find', { kind: 'error', error: unavailable() });
    store.add();
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'pending', registration: 'pending' });
    expect(store.rows[0]?.nextAttemptAt?.getTime()).toBeGreaterThan(START.getTime());
    expect(partners.partners).toHaveLength(0);
    advance(60_000);
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'confirmed' });
  });

  it('an authentication failure is retried slowly and gives the attempt back', async () => {
    const { service, store, partners } = build();
    partners.script('find', { kind: 'error', error: new SankhyaGatewayError('auth', { code: 'auth_failed', message: 'auth' }) });
    store.add();
    await service.runDue();
    expect(store.failures[0]).toMatchObject({ kind: 'retry', consumesAttempt: false });
    expect(store.rows[0]?.attempts).toBe(0);
  });

  it('more than one partner with the origin is rejected and nothing is adopted or written', async () => {
    const { service, store, partners } = build();
    const request = { ...COMMAND, originField: SETTINGS.originField, priceTableCode: 5 } as never;
    partners.seed(request);
    partners.seed(request);
    store.add();
    await service.runDue();
    expect(store.rows[0]).toMatchObject({ status: 'rejected', rejectionCode: 'ambiguous_origin' });
    expect(partners.count('upsert')).toBe(0);
  });

  it('a reread that does not match the request is parked for a person, not confirmed', async () => {
    const { service, store, partners } = build();
    partners.script('read', { kind: 'ok' });
    store.add({ ...COMMAND, sellerCode: 7 });
    // The ERP stores another seller than the one requested.
    const original = partners.upsert.bind(partners);
    partners.upsert = (request, taken) => original({ ...request, sellerCode: 99 }, taken);
    await service.runDue();
    expect(store.confirmations).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: 'unknown', registration: 'unknown' });
    expect(store.failures[0]).toMatchObject({ kind: 'park', errorCode: 'reread_mismatch' });
  });

  it('gives up after the maximum attempts of a temporary failure', async () => {
    const { service, store, partners, advance } = build();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 1; i += 1) partners.script('find', { kind: 'error', error: unavailable() });
    store.add();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 1; i += 1) {
      await service.runDue();
      advance(20 * 60_000);
    }
    expect(store.rows[0]).toMatchObject({ status: 'rejected', registration: 'rejected', rejectionCode: 'timeout' });
    expect(partners.partners).toHaveLength(0);
  });

  it('an invalid stored command is rejected without calling the ERP', async () => {
    const { service, store, partners } = build();
    store.add({ version: 1, originKey: 'x' });
    await service.runDue();
    expect(partners.calls).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: 'rejected', rejectionCode: 'invalid_command' });
  });

  /** M-2: the worker repeats the contract's limits, so a payload written by anything but the current API never reaches the ERP. */
  describe('the stored command keeps the size and shape limits of the contract (M-2)', () => {
    const address = { streetCode: 1, neighborhoodCode: 2, number: '123456', complement: 'c'.repeat(30), postalCode: '01310100' };
    const atLimit = {
      ...COMMAND,
      name: 'N'.repeat(100),
      tradeName: 'R'.repeat(100),
      stateRegistration: 'I'.repeat(16),
      email: `${'a'.repeat(68)}@exemplo.com`,
      phone: '1'.repeat(13),
      notes: `${'o'.repeat(3990)}\n\tfim`,
      icmsClassification: 'X',
      addresses: [address],
    };

    it('delivers a command exactly at every limit', async () => {
      const { service, store, partners } = build();
      store.add(atLimit);
      await service.runDue();
      expect(store.rows[0]).toMatchObject({ status: 'confirmed' });
      expect(partners.count('upsert')).toBe(1);
    });

    it.each([
      ['name', { name: 'N'.repeat(101) }],
      ['tradeName', { tradeName: 'R'.repeat(101) }],
      ['stateRegistration', { stateRegistration: 'I'.repeat(17) }],
      ['email', { email: `${'a'.repeat(72)}@exemplo.com` }],
      ['email shape', { email: 'sem-arroba' }],
      ['phone', { phone: '1'.repeat(14) }],
      ['phone with punctuation', { phone: '(11) 99999-0000' }],
      ['notes', { notes: 'o'.repeat(4001) }],
      ['address number', { addresses: [{ ...address, number: '1234567' }] }],
      ['address complement', { addresses: [{ ...address, complement: 'c'.repeat(31) }] }],
      ['postal code', { addresses: [{ ...address, postalCode: '01310-100' }] }],
      ['postal code length', { addresses: [{ ...address, postalCode: '0131010' }] }],
      ['icmsClassification outside the list', { icmsClassification: 'Z' }],
      ['empty icmsClassification', { icmsClassification: '' }],
      ['document of 15 digits', { document: '112223330001811' }],
      ['document of 12 digits', { document: '112223330001' }],
      ['document with punctuation', { document: '11.222.333/0001-81' }],
      ['bidi override in the name', { name: 'Cliente\u202eLtda' }],
      ['zero-width space in the trade name', { tradeName: 'Fantasia\u200b' }],
      ['line separator in the number', { addresses: [{ ...address, number: '1\u20282' }] }],
      ['control character in the notes', { notes: 'a\u0000b' }],
    ])('rejects for good, with nothing sent to the ERP: %s', async (_label, change) => {
      const { service, store, partners, advance } = build();
      store.add({ ...COMMAND, ...change });
      await service.runDue();
      expect(partners.calls).toHaveLength(0);
      expect(store.rows[0]).toMatchObject({ status: 'rejected', registration: 'rejected', rejectionCode: 'invalid_command', nextAttemptAt: null });
      // Never retried: a later sweep finds nothing to do.
      advance(24 * 3600_000);
      expect(await service.runDue()).toMatchObject({ processed: 0 });
      expect(partners.calls).toHaveLength(0);
    });
  });

  it('a registration that is no longer pending is not delivered', async () => {
    const { service, store, partners } = build();
    store.add(COMMAND, 'rejected');
    await service.runDue();
    expect(partners.calls).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: 'rejected', rejectionCode: 'registration_not_deliverable' });
  });
});
