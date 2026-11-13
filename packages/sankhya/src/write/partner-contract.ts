import type { Customer } from '@salesforce/domain';

/**
 * Customer (ERP partner) write contract (D-AR). Everything the worker hands to the gateway is already resolved from
 * configuration and the request: the adapter holds NO commercial literal.
 *
 * Idempotency (SNK-4): `originKey` is `force:<clientRequestId>` and is written to the dedicated origin field
 * `originField` (a custom partner column, never Vidya's). The worker proves with `findPartnerByOrigin` that the partner
 * does not exist before ANY write or resend, and with `findPartnerByDocument` that the document is not already taken.
 * No heuristic matching.
 *
 * Fields the Force never sends (owner ruling, D-AQ/B6): credit limit, partner type, region, billing-slip type. The
 * ERP defaults apply. The credit limit is NEVER written.
 */
export interface PartnerAddress {
  /** Existing street code chosen by search (V1: the Force does not create streets). */
  readonly streetCode: number;
  /** Existing neighborhood code chosen by search. */
  readonly neighborhoodCode: number;
  readonly number: string | null;
  readonly complement: string | null;
  /** Digits only. */
  readonly postalCode: string | null;
}

export interface PartnerWriteRequest {
  readonly originField: string;
  /** `force:<uuid>`, identical on every resend. */
  readonly originKey: string;
  /** Digits only, already validated as CPF/CNPJ by the domain. */
  readonly document: string;
  readonly personType: 'individual' | 'company';
  readonly name: string;
  readonly tradeName: string | null;
  /** Tax classification chosen by the seller (default from configuration). */
  readonly icmsClassification: string;
  readonly stateRegistration: string | null;
  /** The account's seller (or the one a manager/admin chose). */
  readonly sellerCode: number | null;
  /** Default price table of the installation (configuration, not a literal). */
  readonly priceTableCode: number | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  readonly addresses: readonly PartnerAddress[];
}

export interface PartnerWriteResult {
  /** The code assigned by the ERP. */
  readonly code: number;
}

/** A partner found in the ERP by origin or by document (numbers and identifiers only). */
export interface ErpPartnerRef {
  readonly code: number;
  readonly originKey: string | null;
  /** Digits only. */
  readonly document: string | null;
}

export interface PartnerCallOptions {
  readonly signal?: AbortSignal;
}

export interface SankhyaPartnerWritePort {
  /** NEVER called before `findPartnerByOrigin` returned null and `findPartnerByDocument` returned null (SNK-4). */
  upsertPartner(request: PartnerWriteRequest, options?: PartnerCallOptions): Promise<PartnerWriteResult>;
  /** `null` = absent; more than one match raises `ambiguous_origin` (permanent; a person has to look). */
  findPartnerByOrigin(originField: string, originKey: string, options?: PartnerCallOptions): Promise<ErpPartnerRef | null>;
  /** `null` = absent; more than one match raises `ambiguous_document`. */
  findPartnerByDocument(document: string, options?: PartnerCallOptions): Promise<ErpPartnerRef | null>;
  /** The reread after writing (D-AR): the partner as the ERP stores it, in Sales Force shape. */
  readWrittenPartner(code: number, options?: PartnerCallOptions): Promise<Customer | null>;
}

export const PARTNER_WRITE_NOT_ENABLED_MESSAGE =
  'ERP customer writes are not enabled for this gateway: the Sandbox write test is pending. NEEDS VALIDATION (customer-write plan T3; SNK-4, SNK-6). ' +
  'They require SANKHYA_CUSTOMER_WRITE_ENABLED=true on staging against the Sandbox.';
