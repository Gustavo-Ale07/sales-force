import { CreateCustomerRequestSchema } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { MAX_CUSTOMER_CREATIONS_PER_HOUR, CustomerRegistrationService } from '../../src/customers/customer-registration.service.js';
import type { CustomerRegistrationRepository, CustomerRegistrationRow, DocumentHolder } from '../../src/customers/customer-registration.repository.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import type { AuditService } from '../../src/iam/audit.service.js';

const ID = '0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const DOC = '11222333000181';
const GENERIC = 'Não foi possível cadastrar este documento. Procure o backoffice.';

function mirrorHolder(overrides: Partial<Extract<DocumentHolder, { source: 'mirror' }>> = {}): DocumentHolder {
  return { source: 'mirror', code: 555, name: 'Metalúrgica Alfa Ltda', sellerCode: 7, usable: true, ...overrides };
}
const NOW = new Date('2026-11-13T12:00:00Z');

function request(overrides: Record<string, unknown> = {}) {
  return CreateCustomerRequestSchema.parse({ clientRequestId: ID, document: '11.222.333/0001-81', name: 'Cliente Teste Ltda', stateRegistration: '123456789', ...overrides });
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
  /** Customers of the ERP mirror by document (digits). */
  mirror = new Map<string, DocumentHolder>();
  refusals: Array<{ id: string; accountId: string; reason: string; at: Date }> = [];
  /** Makes the next insert fail like PostgreSQL does on a unique index. */
  insertFailure: { code: string; constraint: string } | null = null;
  sellers = new Set<number>([7, 8]);
  activeSellerExists(code: number): Promise<boolean> {
    return Promise.resolve(this.sellers.has(code));
  }
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
  /** Creations and refused attempts both count (I-1). */
  countSince(): Promise<number> {
    return Promise.resolve(this.recentCount + this.refusals.length);
  }
  findDocumentHolder(taxId: string): Promise<DocumentHolder | null> {
    const inMirror = this.mirror.get(taxId);
    if (inMirror !== undefined) return Promise.resolve(inMirror);
    const open = this.rows.find((r) => r.taxId === taxId && r.status !== 'rejected');
    if (open === undefined) return Promise.resolve(null);
    return Promise.resolve({ source: 'registration', code: open.erpCustomerCode, name: open.name, sellerCode: open.sellerCode });
  }
  recordRefusal(input: { id: string; accountId: string; reason: string; at: Date }): Promise<void> {
    this.refusals.push(input);
    return Promise.resolve();
  }
  insert(row: Omit<CustomerRegistrationRow, 'erpCustomerCode' | 'rejectionCode'> & Partial<CustomerRegistrationRow>): Promise<CustomerRegistrationRow> {
    if (this.insertFailure !== null) return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint'), this.insertFailure));
    const full = { erpCustomerCode: null, rejectionCode: null, ...row } as CustomerRegistrationRow;
    this.rows.push(full);
    return Promise.resolve(full);
  }
  enqueueUpsert(input: { originKey: string; payload: Record<string, unknown> }): Promise<void> {
    this.outbox.push({ originKey: input.originKey, payload: input.payload });
    return Promise.resolve();
  }
}

function build(options: { enabled?: boolean; timeoutMs?: number; scope?: unknown } = {}) {
  const repo = new FakeRepo();
  const audits: Array<{ action: string; detail?: Record<string, unknown> }> = [];
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const service = new CustomerRegistrationService(
    { customerScope: () => Promise.resolve(options.scope ?? { kind: 'all' }) } as unknown as PolicyService,
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
    repo.mirror.set(DOC, mirrorHolder({ sellerCode: 7 }));
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

  it('a manager naming a seller that is not in the mirror (or inactive) is refused, recording nothing', async () => {
    const { service, repo } = build();
    await expect(service.create(user({ role: 'manager', sellerCodes: [] }), request({ sellerCode: 999 }))).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ path: 'sellerCode', code: 'seller_not_found' }] },
    });
    expect(repo.rows).toHaveLength(0);
    expect(repo.outbox).toHaveLength(0);
  });

  it('a manager naming an existing seller is accepted', async () => {
    const { service, repo } = build();
    await service.create(user({ role: 'manager', sellerCodes: [] }), request({ sellerCode: 8 }));
    expect(repo.outbox[0]?.payload).toMatchObject({ sellerCode: 8 });
  });

  it('a scope narrower than the role refuses an owner outside it', async () => {
    const { service, repo } = build({ scope: { kind: 'sellers', sellerCodes: [7] } });
    await expect(service.create(user({ role: 'manager', sellerCodes: [7] }), request({ sellerCode: 8 }))).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ path: 'sellerCode' }] },
    });
    expect(repo.rows).toHaveLength(0);
  });

  it('applies the hourly limit', async () => {
    const { service, repo } = build();
    repo.recentCount = MAX_CUSTOMER_CREATIONS_PER_HOUR;
    await expect(service.create(user(), request())).rejects.toMatchObject({ code: 'rate_limited' });
    expect(repo.rows).toHaveLength(0);
  });
});

/** I-1: a refused duplicate is not an existence oracle for CPF/CNPJ (security review of D-AR). */
describe('CustomerRegistrationService duplicate refusal (I-1)', () => {
  const sellerScope = { kind: 'sellers', sellerCodes: [7] };

  async function refusal(service: CustomerRegistrationService, who: CurrentUser): Promise<AppError> {
    const error = await service.create(who, request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  describe('(a) a refused attempt counts toward the hourly limit, checked before the document', () => {
    it('records the refusal with account, instant and reason only', async () => {
      const { service, repo } = build();
      repo.mirror.set(DOC, mirrorHolder());
      await refusal(service, user());
      expect(repo.refusals).toHaveLength(1);
      expect(repo.refusals[0]).toMatchObject({ accountId: 'acc-1', reason: 'document_already_registered', at: NOW });
      const stored = JSON.stringify(repo.refusals);
      expect(stored).not.toContain(DOC);
      expect(stored).not.toContain('Metalúrgica');
    });

    it('the 31st attempt of the hour is rate limited even when every earlier one was a refused duplicate', async () => {
      const { service, repo } = build();
      repo.mirror.set(DOC, mirrorHolder());
      for (let i = 0; i < MAX_CUSTOMER_CREATIONS_PER_HOUR; i += 1) {
        expect((await refusal(service, user())).code).toBe('conflict');
      }
      expect(repo.refusals).toHaveLength(MAX_CUSTOMER_CREATIONS_PER_HOUR);
      expect((await refusal(service, user())).code).toBe('rate_limited');
      expect(repo.refusals).toHaveLength(MAX_CUSTOMER_CREATIONS_PER_HOUR);
    });

    it('a limited account learns nothing about the document: the limit answer does not depend on it', async () => {
      const { service, repo } = build();
      repo.recentCount = MAX_CUSTOMER_CREATIONS_PER_HOUR;
      repo.mirror.set(DOC, mirrorHolder());
      const taken = await refusal(service, user());
      repo.mirror.delete(DOC);
      const free = await refusal(service, user());
      expect(taken.code).toBe('rate_limited');
      expect(free.code).toBe('rate_limited');
      expect(taken.message).toBe(free.message);
    });
  });

  describe('(b) the message depends on the portfolio, the status and the shape do not', () => {
    const cases: Array<[string, Partial<Extract<DocumentHolder, { source: 'mirror' }>>]> = [
      ['a customer of another seller', { sellerCode: 8 }],
      ['an inactive or blocked customer of the seller', { sellerCode: 7, usable: false }],
      ['a customer without a seller', { sellerCode: null }],
    ];

    it('names the customer (name and code) when it is in the seller portfolio', async () => {
      const { service, repo } = build({ scope: sellerScope });
      repo.mirror.set(DOC, mirrorHolder({ sellerCode: 7 }));
      const error = await refusal(service, user());
      expect(error.code).toBe('conflict');
      expect(error.message).toContain('Metalúrgica Alfa Ltda');
      expect(error.message).toContain('555');
      expect(error.details).toEqual({ reason: 'document_already_registered' });
    });

    it.each(cases)('outside the portfolio (%s): the exact generic message, no name, no seller, same code and details', async (_label, change) => {
      const { service, repo } = build({ scope: sellerScope });
      repo.mirror.set(DOC, mirrorHolder({ sellerCode: 7 }));
      const inside = await refusal(service, user());
      repo.mirror.set(DOC, mirrorHolder(change));
      const outside = await refusal(service, user());
      expect(outside.message).toBe(GENERIC);
      expect(outside.code).toBe(inside.code);
      expect(outside.status).toBe(inside.status);
      expect(outside.details).toEqual(inside.details);
      const body = JSON.stringify({ message: outside.message, details: outside.details });
      expect(body).not.toContain('Metalúrgica');
      expect(body).not.toContain('555');
      expect(body).not.toMatch(/vendedor|carteira/i);
    });

    it('a registration in progress of the seller is named; one of another seller is generic', async () => {
      const { service, repo } = build({ scope: sellerScope });
      await service.create(user(), request({ clientRequestId: '0198f0a2-7b1c-7c3e-9a55-0123456789ac' }));
      const inside = await refusal(service, user({ accountId: 'acc-2' }));
      expect(inside.message).toContain('Cliente Teste Ltda');
      expect(inside.message).not.toBe(GENERIC);
      repo.rows[0]!.sellerCode = 8;
      const outside = await refusal(service, user({ accountId: 'acc-2' }));
      expect(outside.message).toBe(GENERIC);
      expect(outside.code).toBe(inside.code);
      expect(outside.details).toEqual(inside.details);
    });

    it('a manager or admin (scope: everyone) is told who holds an active customer, whoever the seller is', async () => {
      for (const role of ['manager', 'admin'] as const) {
        const { service, repo } = build({ scope: { kind: 'all' } });
        repo.mirror.set(DOC, mirrorHolder({ sellerCode: 8 }));
        const error = (await service.create(user({ role, sellerCodes: [] }), request({ sellerCode: 8 })).catch((e: unknown) => e)) as AppError;
        expect(error.code).toBe('conflict');
        expect(error.message).toContain('Metalúrgica Alfa Ltda');
        expect(error.message).toContain('555');
      }
    });

    it('a manager is still given the generic message for an inactive or blocked customer', async () => {
      const { service, repo } = build({ scope: { kind: 'all' } });
      repo.mirror.set(DOC, mirrorHolder({ sellerCode: 8, usable: false }));
      const error = (await service.create(user({ role: 'manager', sellerCodes: [] }), request({ sellerCode: 8 })).catch((e: unknown) => e)) as AppError;
      expect(error.message).toBe(GENERIC);
    });

    it('a manager whose scope is a subset of sellers gets the generic message for a customer outside it', async () => {
      const { service, repo } = build({ scope: { kind: 'sellers', sellerCodes: [7] } });
      repo.mirror.set(DOC, mirrorHolder({ sellerCode: 8 }));
      const error = (await service.create(user({ role: 'manager', sellerCodes: [7] }), request({ sellerCode: 7 })).catch((e: unknown) => e)) as AppError;
      expect(error.message).toBe(GENERIC);
    });

    it('a duplicate the worker found in the ERP (not in the mirror) is answered with the generic message, on the first call and on a replay', async () => {
      const { service, repo } = build({ scope: sellerScope });
      repo.onPoll = (row) => Object.assign(row, { status: 'rejected', rejectionCode: 'partner_document_duplicate' });
      const first = await refusal(service, user());
      const replay = await refusal(service, user());
      for (const error of [first, replay]) {
        expect(error.message).toBe(GENERIC);
        expect(error.code).toBe('conflict');
        expect(error.details).toEqual({ reason: 'document_already_registered' });
      }
    });
  });

  describe('(c) the refusal is audited with identifiers only', () => {
    it('records customer.registration_refused without document, name or seller of the holder', async () => {
      const { service, repo, audits } = build({ scope: sellerScope });
      repo.mirror.set(DOC, mirrorHolder({ sellerCode: 7 }));
      await refusal(service, user());
      expect(audits.map((a) => a.action)).toEqual(['customer.registration_refused']);
      const text = JSON.stringify(audits);
      expect(text).toContain('document_already_registered');
      expect(text).not.toContain(DOC);
      expect(text).not.toContain('Metalúrgica');
      expect(text).not.toContain('Cliente Teste');
      expect(text).not.toContain('555');
    });
  });
});

/** M-1: the same request id used by another account is a conflict, not a 500, and reveals nothing. */
describe('CustomerRegistrationService request id owned by another account (M-1)', () => {
  it.each(['customer_registration_origin_key_uq', 'customer_registration_account_request_uq'])('a unique violation on %s answers 409 idempotency_conflict', async (constraint) => {
    const { service, repo } = build();
    repo.insertFailure = { code: '23505', constraint };
    const error = (await service.create(user({ accountId: 'acc-2' }), request()).catch((e: unknown) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('idempotency_conflict');
    expect(error.status).toBe(409);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toMatch(/acc-1|origin_key|constraint|force:/);
  });

  it('a violation wrapped by the query layer (cause) is recognised the same way', async () => {
    const { service, repo } = build();
    const wrapped = Object.assign(new Error('Failed query'), { cause: { code: '23505', constraint: 'customer_registration_origin_key_uq' } });
    repo.insert = () => Promise.reject(wrapped);
    await expect(service.create(user(), request())).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('any other database failure is not swallowed', async () => {
    const { service, repo } = build();
    repo.insertFailure = { code: '23505', constraint: 'some_other_index' };
    await expect(service.create(user(), request())).rejects.not.toBeInstanceOf(AppError);
  });
});
