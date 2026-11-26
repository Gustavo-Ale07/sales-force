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

/**
 * One address of the command. `cityCode` is an ERP city (validated against the mirror before the command is stored). Street and
 * neighborhood: a mirrored code (0 = none) or, when the name matched nothing in the mirror, the text the worker creates in the
 * Sankhya Sandbox (the server never sends both a code and a name for the same part).
 */
export interface CustomerUpsertAddress {
  readonly cityCode: number;
  readonly streetCode: number;
  readonly neighborhoodCode: number;
  readonly streetName: string | null;
  readonly neighborhoodName: string | null;
  readonly number: string | null;
  readonly complement: string | null;
  readonly postalCode: string | null;
}

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
  readonly addresses: ReadonlyArray<CustomerUpsertAddress>;
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
  readonly role: 'seller' | 'manager' | 'admin' | 'technical' | 'operations';
  readonly sellerCodes: readonly number[];
  /**
   * The seller codes the resolved data scope reaches (`PolicyService.customerScope`): `null` = every seller
   * (manager/admin). A chosen owner outside it is refused, whatever the role.
   */
  readonly allowedSellerCodes?: readonly number[] | null;
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

  // IE (owner ruling 2026-11-13): mandatory for a company (the IE or "Isento", stored as ISENTO, case-insensitive);
  // an individual has no such field. No per-state format validation.
  const typedIe = body.stateRegistration?.trim() ?? '';
  // Owner 2026-11-25: IE does not apply to an individual; whatever the client sends ("Isento" included) is ignored, never an error.
  const typed = typedIe.toUpperCase() === 'ISENTO' ? 'ISENTO' : typedIe === '' ? null : typedIe;
  const stateRegistration = kind === 'individual' ? null : typed;
  if (kind === 'company' && stateRegistration === null) {
    issues.push({ path: 'stateRegistration', code: 'state_registration_required', message: 'Informe a inscrição estadual ou marque "Isento".' });
  }

  const chosen = chooseSeller(body.sellerCode, actor);
  const sellerCode = chosen !== null && actor.allowedSellerCodes != null && !actor.allowedSellerCodes.includes(chosen) ? null : chosen;
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
    stateRegistration,
    sellerCode,
    phone: body.phone,
    email: body.email,
    notes: body.notes,
    addresses: body.addresses.map((a) => ({
      cityCode: a.cityCode,
      streetCode: a.streetCode,
      neighborhoodCode: a.neighborhoodCode,
      streetName: a.streetCode > 0 ? null : a.streetName,
      neighborhoodName: a.neighborhoodCode > 0 ? null : a.neighborhoodName,
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
    // Owner 2026-11-25: a seller's customer is linked to them by the server; the client value is ignored. Only a seller
    // with several links still names one of them.
    if (actor.sellerCodes.length === 1) return actor.sellerCodes[0] ?? null;
    if (requested !== undefined) return actor.sellerCodes.includes(requested) ? requested : null;
    return null;
  }
  if (requested !== undefined) return requested;
  return actor.sellerCodes.length === 1 ? (actor.sellerCodes[0] ?? null) : null;
}
