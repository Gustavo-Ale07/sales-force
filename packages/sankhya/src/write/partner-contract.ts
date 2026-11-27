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
  /** ERP city code (TSICID.CODCID); required, > 0 (owner decision: the city is always chosen from the ERP registry). */
  readonly cityCode: number;
  /** Street code (TSIEND.CODEND), 0 = none. The worker resolves `streetName` into a code before the partner is written. */
  readonly streetCode: number;
  /** Neighborhood code (TSIBAI.CODBAI), 0 = none. The worker resolves `neighborhoodName` into a code before the partner is written. */
  readonly neighborhoodCode: number;
  /** Free street text (type + name, e.g. "RUA DAS FLORES") when no code was matched; created in the Sandbox by the worker (SNK-3 only). */
  readonly streetName?: string | null;
  /** Free neighborhood text when no code was matched; created in the Sandbox by the worker (SNK-3 only). */
  readonly neighborhoodName?: string | null;
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
  /** The price table (TGFPAR.CODTAB) chosen in the registration, validated against the mirror by the server. Never null at the wire (owner 2026-11-27). */
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

/**
 * The only partner columns an edit may touch (D-AP, D-AR 5): phone, e-mail and notes. A present key REPLACES the stored value
 * (`null` clears it). Contacts and addresses have no validated ERP mapping (S5.2, NEEDS VALIDATION) and are refused by the adapter.
 */
export interface PartnerEditableChanges {
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly notes?: string | null;
  /** TGFPAR.CODTAB (owner 2026-11-27): a present key replaces the price table; never null (a customer is never left without one). */
  readonly priceTableCode?: number;
  /** Never mapped: present only so that the adapter can refuse it by name (nothing is sent). */
  readonly contacts?: unknown;
  readonly addresses?: unknown;
}

export interface PartnerUpdateRequest {
  /** The ERP partner code (`CODPARC`) of an existing customer. */
  readonly code: number;
  readonly changes: PartnerEditableChanges;
}

/** The editable columns as the ERP stores them (the reread after an edit); `null` = empty. */
export interface PartnerEditableFields {
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  /** TGFPAR.CODTAB as stored; `null` = empty. */
  readonly priceTableCode: number | null;
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
  /**
   * Edit of an existing customer (D-AP, owner approval 2026-11-25, Sandbox only). A state write of phone, e-mail and notes: repeating it
   * with the same values is harmless, and the worker re-reads with `readPartnerEditableFields` before any resend (SNK-4 for edits).
   * Same closed switch as `upsertPartner`. Never touches document, name, seller, price table, status or limits.
   */
  updatePartner(request: PartnerUpdateRequest, options?: PartnerCallOptions): Promise<void>;
  /** The reread of an edit: phone, e-mail and notes as stored; `null` = no such partner. */
  readPartnerEditableFields(code: number, options?: PartnerCallOptions): Promise<PartnerEditableFields | null>;
  /**
   * Address registry creation (owner decision change 2026-11-26: neighborhood and street missing from the mirror are created in the
   * Sankhya SANDBOX). Idempotent (SNK-4): the adapter first looks the name up live (accent/case-insensitive) and returns the existing
   * code with `created: false`; only when absent does it create (serialized, the next free code). Refused outside SANKHYA_ENVIRONMENT=sandbox (SNK-3).
   */
  ensureNeighborhood(name: string, options?: PartnerCallOptions): Promise<EnsuredAddressEntry>;
  /** Same contract for a street; the type (TIPO) is split from the name and stored in uppercase. */
  ensureStreet(name: string, options?: PartnerCallOptions): Promise<EnsuredAddressEntry>;
}

export interface EnsuredAddressEntry {
  readonly code: number;
  /** `true` when this call created the registry row, `false` when it already existed. */
  readonly created: boolean;
}

export const ADDRESS_REGISTRY_WRITE_NOT_VALIDATED_MESSAGE =
  'Creating a neighborhood or street in the ERP is not validated against the Sandbox yet (primary-key generation and the neighborhood region code were never read). NEEDS VALIDATION (S5.2); nothing was sent.';

export const PARTNER_WRITE_NOT_ENABLED_MESSAGE =
  'ERP customer writes are not enabled for this gateway: the Sandbox write test is pending. NEEDS VALIDATION (customer-write plan T3; SNK-4, SNK-6). ' +
  'They require SANKHYA_CUSTOMER_WRITE_ENABLED=true on staging against the Sandbox.';
