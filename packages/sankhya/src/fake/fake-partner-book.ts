import { SankhyaGatewayError } from '../errors.js';
import type { ErpPartnerRef, PartnerEditableChanges, PartnerWriteRequest } from '../write/partner-contract.js';

/** Scripted outcome of one fake ERP partner call (consumed in order, default `ok`). */
export type FakePartnerOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly error: SankhyaGatewayError }
  /** `upsert`/`update` only: the ERP did apply the write but the caller sees a failure (timeout after commit). */
  | { readonly kind: 'created_then_error'; readonly error: SankhyaGatewayError };

export type FakePartnerOperation = 'upsert' | 'find' | 'read' | 'update';

export interface FakeStoredPartner {
  readonly code: number;
  readonly request: PartnerWriteRequest;
}

export interface FakePartnerCall {
  readonly operation: FakePartnerOperation;
  readonly originKey?: string;
  readonly code?: number;
}

/**
 * In-memory stand-in for the ERP partner table, with NO native idempotency on purpose: a second write of the same
 * origin creates a second partner when the caller skipped the lookups, so a test that counts `partners` proves the
 * worker never double-sent. A document already present is refused like the ERP's own uniqueness check.
 */
export class FakePartnerBook {
  readonly partners: FakeStoredPartner[] = [];
  readonly calls: FakePartnerCall[] = [];
  readonly #scripts: Record<FakePartnerOperation, FakePartnerOutcome[]> = { upsert: [], find: [], read: [], update: [] };
  #next: number;

  constructor(firstCode = 900_001) {
    this.#next = firstCode;
  }

  script(operation: FakePartnerOperation, ...outcomes: FakePartnerOutcome[]): void {
    this.#scripts[operation].push(...outcomes);
  }

  count(operation: FakePartnerOperation): number {
    return this.calls.filter((call) => call.operation === operation).length;
  }

  /** Test setup: places a partner without going through the write path (no duplicate check, no script). */
  seed(request: PartnerWriteRequest): number {
    const code = this.#next;
    this.#next += 1;
    this.partners.push({ code, request });
    return code;
  }

  #take(operation: FakePartnerOperation): FakePartnerOutcome {
    return this.#scripts[operation].shift() ?? { kind: 'ok' };
  }

  upsert(request: PartnerWriteRequest, documentTaken: (document: string) => boolean): { code: number } {
    this.calls.push({ operation: 'upsert', originKey: request.originKey });
    const outcome = this.#take('upsert');
    if (outcome.kind === 'error') throw outcome.error;
    if (documentTaken(request.document) || this.partners.some((p) => p.request.document === request.document)) {
      throw new SankhyaGatewayError('validation', {
        code: 'partner_document_duplicate',
        message: 'A partner with this CPF/CNPJ already exists in the ERP.',
      });
    }
    const code = this.seed(request);
    if (outcome.kind === 'created_then_error') throw outcome.error;
    return { code };
  }

  /**
   * Edit of a stored partner: phone, e-mail and notes only (a key present replaces, `null` clears). A partner of the demo dataset
   * (not written by the Force) is not in this book: `false` tells the caller to treat it as absent from the book.
   */
  update(code: number, changes: PartnerEditableChanges): boolean {
    this.calls.push({ operation: 'update', code });
    const outcome = this.#take('update');
    if (outcome.kind === 'error') throw outcome.error;
    const index = this.partners.findIndex((p) => p.code === code);
    const current = this.partners[index];
    if (current === undefined) {
      if (outcome.kind === 'created_then_error') throw outcome.error;
      return false;
    }
    const request: PartnerWriteRequest = {
      ...current.request,
      ...(changes.phone === undefined ? {} : { phone: changes.phone }),
      ...(changes.email === undefined ? {} : { email: changes.email }),
      ...(changes.notes === undefined ? {} : { notes: changes.notes }),
    };
    this.partners[index] = { code, request };
    if (outcome.kind === 'created_then_error') throw outcome.error;
    return true;
  }

  findByOrigin(originKey: string): ErpPartnerRef | null {
    this.calls.push({ operation: 'find', originKey });
    const outcome = this.#take('find');
    if (outcome.kind !== 'ok') throw outcome.error;
    const matches = this.partners.filter((p) => p.request.originKey === originKey);
    if (matches.length > 1) throw ambiguous('ambiguous_origin', matches.map((p) => p.code), 'origin key');
    const found = matches[0];
    return found === undefined ? null : { code: found.code, originKey: found.request.originKey, document: found.request.document };
  }

  findByDocument(document: string): ErpPartnerRef | null {
    this.calls.push({ operation: 'find' });
    const outcome = this.#take('find');
    if (outcome.kind !== 'ok') throw outcome.error;
    const matches = this.partners.filter((p) => p.request.document === document);
    if (matches.length > 1) throw ambiguous('ambiguous_document', matches.map((p) => p.code), 'document');
    const found = matches[0];
    return found === undefined ? null : { code: found.code, originKey: found.request.originKey, document: found.request.document };
  }

  read(code: number): FakeStoredPartner | null {
    this.calls.push({ operation: 'read', code });
    const outcome = this.#take('read');
    if (outcome.kind !== 'ok') throw outcome.error;
    return this.partners.find((p) => p.code === code) ?? null;
  }
}

function ambiguous(code: 'ambiguous_origin' | 'ambiguous_document', codes: readonly number[], what: string): SankhyaGatewayError {
  return new SankhyaGatewayError('permanent', {
    code,
    message: `More than one ERP partner carries the same ${what} (codes ${codes.join(', ')}); none adopted, nothing resent; manual reconciliation is required.`,
  });
}
