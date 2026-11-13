import { CreateCustomerRequestSchema } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { MAX_CUSTOMER_CREATIONS_PER_HOUR, CustomerRegistrationService } from '../../src/customers/customer-registration.service.js';
import type { CustomerRegistrationRepository, CustomerRegistrationRow } from '../../src/customers/customer-registration.repository.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import type { AuditService } from '../../src/iam/audit.service.js';

const ID = '0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const NOW = new Date('2026-11-13T12:00:00Z');

function request(overrides: Record<string, unknown> = {}) {
  return CreateCustomerRequestSchema.parse({ clientRequestId: ID, document: '11.222.333/0001-81', name: 'Cliente Teste Ltda', ...overrides });
}

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    accountId: 'acc-1',
    username: 'v1',
    displayName: 'Vendedor',
    role: 'seller',
    sellerCodes: [7],
    sessionId: 's',
    sessionExpiresAt: new Date('2027-01-01'),
    channel: 'web',
    ...overrides,
  };
}

/** In-memory repository: the transaction just runs the work; everything else is a simple store. */
class FakeRepo {
  rows: CustomerRegistrationRow[] = [];
  outbox: Array<{ originKey: string; payload: Record<string, unknown> }> = [];
  mirrorDocuments = new Set<string>();
  recentCount = 0;
  /** Called after every `findById` so a test can play the worker. */
  onPoll: (row: CustomerRegistrationRow) => void = () => undefined;

  transaction<T>(work: (tx: never) => Promise<T>): Promise<T> {
    return work(undefined as never);
  }
  lockDocument(): Promise<void> {
    return Promise.resolve();
  }
  findByRequest(accountId: string, clientRequestId: string): Promise<CustomerRegistrationRow | null> {
    return Promise.resolve(this.rows.find((r) => r.createdByAccountId === accountId && r.clientRequestId === clientRequestId) ?? null);
  }
  findById(id: string): Promise<CustomerRegistrationRow | null> {
    const row = this.rows.find((r) => r.id === id) ?? null;
    if (row !== null) this.onPoll(row);
    return Promise.resolve(row);
  }
  countSince(): Promise<number> {
    return Promise.resolve(this.recentCount);
  }
  mirrorHasDocument(taxId: string): Promise<boolean> {
    return Promise.resolve(this.mirrorDocuments.has(taxId));
  }
  openRegistrationHasDocument(taxId: string): Promise<boolean> {
    return Promise.resolve(this.rows.some((r) => r.taxId === taxId && r.status !== 'rejected'));
  }
  insert(row: Omit<CustomerRegistrationRow, 'erpCustomerCode' | 'rejectionCode'> & Partial<CustomerRegistrationRow>): Promise<CustomerRegistrationRow> {
    const full = { erpCustomerCode: null, rejectionCode: null, ...row } as CustomerRegistrationRow;
    this.rows.push(full);
    return Promise.resolve(full);
  }
  enqueueUpsert(input: { originKey: string; payload: Record<string, unknown> }): Promise<void> {
    this.outbox.push({ originKey: input.originKey, payload: input.payload });
    return Promise.resolve();
  }
}

function build(options: { enabled?: boolean; timeoutMs?: number } = {}) {
  const repo = new FakeRepo();
  const audits: Array<{ action: string; detail?: Record<string, unknown> }> = [];
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const service = new CustomerRegistrationService(
    { customerScope: () => Promise.resolve({ kind: 'all' }) } as unknown as PolicyService,
    repo as unknown as CustomerRegistrationRepository,
    { record: (entry: { action: string; detail?: Record<string, unknown> }) => { audits.push(entry); return Promise.resolve(); } } as unknown as AuditService,
    clock,
    options.enabled ?? true,
    {
      timeoutMs: options.timeoutMs ?? 1000,
      pollMs: 100,
      sleep: (ms: number) => { now += ms; return Promise.resolve(); },
    },
  );
  return { service, repo, audits };
}

describe('CustomerRegistrationService.create', () => {
  it('is closed by default: 409 customer_write_disabled and nothing is recorded', async () => {
    const { service, repo } = build({ enabled: false });
    await expect(service.create(user(), request())).rejects.toMatchObject({ code: 'conflict', details: { reason: 'customer_write_disabled' } });
    expect(repo.rows).toHaveLength(0);
    expect(repo.outbox).toHaveLength(0);
  });

  it('records the request and exactly one outbox command, and answers 202 pending when the worker does not answer in time', async () => {
    const { service, repo, audits } = build();
    const out = await service.create(user(), request());
    expect(out.httpStatus).toBe(202);
    expect(out.response).toMatchObject({ status: 'pending', customerCode: null, originKey: `force:${ID}` });
    expect(repo.rows).toHaveLength(1);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0]?.originKey).toBe(`force:${ID}`);
    expect(repo.outbox[0]?.payload).toMatchObject({ document: '11222333000181', sellerCode: 7, icmsClassification: 'R' });
    expect(audits.map((a) => a.action)).toEqual(['customer.registration_requested']);
  });

  it('keeps personal data out of the audit trail', async () => {
    const { service, audits } = build();
    await service.create(user(), request({ email: 'x@example.test', phone: '11999990000' }));
    const text = JSON.stringify(audits);
    expect(text).not.toContain('11222333000181');
    expect(text).not.toContain('Cliente Teste');
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('11999990000');
  });

  it('answers 201 with the real code when the worker confirms during the wait', async () => {
    const { service, repo } = build();
    let polls = 0;
    repo.onPoll = (row) => {
      polls += 1;
      if (polls === 3) Object.assign(row, { status: 'confirmed', erpCustomerCode: 4321 });
    };
    const out = await service.create(user(), request());
    expect(out.httpStatus).toBe(201);
    expect(out.response).toMatchObject({ status: 'confirmed', customerCode: 4321 });
  });

  it('a rejected duplicate document answers 409 document_already_registered', async () => {
    const { service, repo } = build();
    repo.onPoll = (row) => Object.assign(row, { status: 'rejected', rejectionCode: 'partner_document_duplicate' });
    await expect(service.create(user(), request())).rejects.toMatchObject({ code: 'conflict', details: { reason: 'document_already_registered' } });
  });

  it('refuses a document already in the ERP mirror, before recording anything', async () => {
    const { service, repo } = build();
    repo.mirrorDocuments.add('11222333000181');
    await expect(service.create(user(), request())).rejects.toMatchObject({ details: { reason: 'document_already_registered' } });
    expect(repo.rows).toHaveLength(0);
    expect(repo.outbox).toHaveLength(0);
  });

  it('refuses a document that another request already has in flight', async () => {
    const { service } = build();
    await service.create(user(), request());
    await expect(service.create(user({ accountId: 'acc-2' }), request({ clientRequestId: '0198f0a2-7b1c-7c3e-9a55-0123456789ac' }))).rejects.toMatchObject({
      details: { reason: 'document_already_registered' },
    });
  });

  it('a replay of the same request returns the recorded state (200) and creates nothing new', async () => {
    const { service, repo } = build();
    await service.create(user(), request());
    const again = await service.create(user(), request());
    expect(again.httpStatus).toBe(200);
    expect(repo.rows).toHaveLength(1);
    expect(repo.outbox).toHaveLength(1);
  });

  it('the same request id with another content is an idempotency conflict', async () => {
    const { service } = build();
    await service.create(user(), request());
    await expect(service.create(user(), request({ name: 'Outro Nome' }))).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('refuses an invalid document with the issue path, recording nothing', async () => {
    const { service, repo } = build();
    const error = await service.create(user(), request({ document: '11.222.333/0001-82' })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'validation_failed', details: { issues: [{ path: 'document' }] } });
    expect(repo.rows).toHaveLength(0);
  });

  it('applies the hourly limit', async () => {
    const { service, repo } = build();
    repo.recentCount = MAX_CUSTOMER_CREATIONS_PER_HOUR;
    await expect(service.create(user(), request())).rejects.toMatchObject({ code: 'rate_limited' });
    expect(repo.rows).toHaveLength(0);
  });
});
