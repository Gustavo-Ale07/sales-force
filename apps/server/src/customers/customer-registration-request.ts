import { createHash } from 'node:crypto';
import type { CreateCustomerRequest } from '@salesforce/contracts';
import {
  customerOriginKey,
  isValidCnpj,
  isValidCpf,
  normalizeTaxDocument,
  taxDocumentKind,
  type TaxDocumentKind,
} from '@salesforce/domain';
import type { AppErrorIssue } from '../http/app-error.js';

/** The command the worker receives in `integration_outbox.payload` (operation `customer.upsert`). */
export interface CustomerUpsertPayload {
  readonly version: 1;
  readonly originKey: string;
  readonly document: string;
  readonly personType: TaxDocumentKind;
  readonly name: string;
  readonly tradeName: string | null;
  readonly icmsClassification: string;
  readonly stateRegistration: string | null;
  readonly sellerCode: number;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  readonly addresses: ReadonlyArray<{
    readonly streetCode: number;
    readonly neighborhoodCode: number;
    readonly number: string;
    readonly complement: string | null;
    readonly postalCode: string;
  }>;
}

export interface PreparedCustomerRegistration {
  readonly payload: CustomerUpsertPayload;
  /** SHA-256 (hex) of the canonical content, `clientRequestId` excluded. */
  readonly fingerprint: string;
}

export type PrepareOutcome =
  | { readonly ok: true; readonly value: PreparedCustomerRegistration }
  | { readonly ok: false; readonly issues: AppErrorIssue[] };

export interface RegistrationActor {
  readonly role: 'seller' | 'manager' | 'admin' | 'technical';
  readonly sellerCodes: readonly number[];
}

/**
 * Pure rules of a creation request: the document must be a valid CPF/CNPJ, and the owner seller is decided here.
 * A seller always owns what they create (their own linked code; with several links the request must name one of
 * them). A manager/admin names the seller, or uses their single linked code. Anything else is an issue, never a guess.
 */
export function prepareCustomerRegistration(body: CreateCustomerRequest, actor: RegistrationActor): PrepareOutcome {
  const issues: AppErrorIssue[] = [];
  const document = normalizeTaxDocument(body.document);
  const kind = taxDocumentKind(document);
  const valid = kind === 'individual' ? isValidCpf(document) : kind === 'company' ? isValidCnpj(document) : false;
  if (kind === null || !valid) issues.push({ path: 'document', code: 'invalid_document', message: 'CPF ou CNPJ inválido.' });

  const sellerCode = chooseSeller(body.sellerCode, actor);
  if (sellerCode === null) {
    issues.push({
      path: 'sellerCode',
      code: actor.role === 'seller' ? 'seller_not_linked' : 'seller_required',
      message: 'Informe o vendedor responsável pelo cliente.',
    });
  }
  if (issues.length > 0 || kind === null || sellerCode === null) return { ok: false, issues };

  const payload: CustomerUpsertPayload = {
    version: 1,
    originKey: customerOriginKey(body.clientRequestId),
    document,
    personType: kind,
    name: body.name,
    tradeName: body.tradeName,
    icmsClassification: body.icmsClassification,
    stateRegistration: body.stateRegistration,
    sellerCode,
    phone: body.phone,
    email: body.email,
    notes: body.notes,
    addresses: body.addresses.map((a) => ({
      streetCode: a.streetCode,
      neighborhoodCode: a.neighborhoodCode,
      number: a.number,
      complement: a.complement,
      postalCode: a.postalCode,
    })),
  };
  const { originKey: _origin, ...content } = payload;
  void _origin;
  const fingerprint = createHash('sha256').update(JSON.stringify(['v1', content])).digest('hex');
  return { ok: true, value: { payload, fingerprint } };
}

function chooseSeller(requested: number | undefined, actor: RegistrationActor): number | null {
  if (actor.role === 'seller') {
    if (requested !== undefined) return actor.sellerCodes.includes(requested) ? requested : null;
    return actor.sellerCodes.length === 1 ? (actor.sellerCodes[0] ?? null) : null;
  }
  if (requested !== undefined) return requested;
  return actor.sellerCodes.length === 1 ? (actor.sellerCodes[0] ?? null) : null;
}
