import type { CustomerReasonCodeSchema, CustomerRegistrationView } from '@salesforce/contracts';
import { customerStateLabel, customerStateOfDelivery } from '@salesforce/domain';
import type { z } from 'zod';

type ReasonCode = z.infer<typeof CustomerReasonCodeSchema>;

/** Exactly what the API reads of the outbox command of a registration to explain its state. */
export interface RegistrationOutboxFacts {
  readonly status: string;
  readonly nextAttemptAt: Date | null;
  /** `<code>: <message>` as the worker stored it (sanitized, masked). */
  readonly lastErrorMessage: string | null;
}

export interface RegistrationFacts {
  readonly id: string;
  readonly status: string;
  readonly erpCustomerCode: number | null;
  readonly originKey: string;
  readonly taxId: string;
  readonly name: string;
  readonly sellerCode: number | null;
  readonly rejectionCode: string | null;
  readonly correctsRegistrationId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** pending/unknown = still being delivered (never unlocked for a transient error); confirmed = sent; rejected = definitive refusal. */
export const stateOfRegistration = customerStateOfDelivery;

const GENERIC_REFUSAL = 'O Sankhya recusou o cadastro do cliente. Confira os dados e tente novamente.';
const DUPLICATE_REFUSAL = 'Não foi possível cadastrar este documento. Procure o backoffice.';

/**
 * The readable text of a refusal. The adapter's own sentence ("The ERP refused the partner: <reason>.") is unwrapped; the reason inside
 * it was sanitized by the adapter (documents masked, control characters removed, 300 characters). Anything else is the generic text.
 */
export function refusalText(stored: string | null): string {
  const match = /The ERP refused the partner(?:: (.+?)\.?\s*$| \(no message\)\.?\s*$)/s.exec(stored ?? '');
  const reason = match?.[1]?.trim();
  return reason === undefined || reason === '' ? GENERIC_REFUSAL : `O Sankhya recusou o cadastro: ${reason}`;
}

export function reasonOfRegistration(
  status: string,
  rejectionCode: string | null,
  outbox: RegistrationOutboxFacts | null,
): { readonly code: ReasonCode; readonly message: string } | null {
  if (status === 'rejected') {
    switch (rejectionCode) {
      // Whose it is was never looked up against this reader's portfolio: the generic text, identical for everyone (R17, I-1).
      case 'partner_document_duplicate':
        return { code: 'document_already_registered', message: DUPLICATE_REFUSAL };
      case 'partner_required_field':
        return { code: 'required_field', message: refusalText(outbox?.lastErrorMessage ?? null) };
      case 'invalid_command':
        return { code: 'invalid_command', message: 'Os dados deste cadastro não são válidos. Refaça o cadastro.' };
      default:
        // Any other refusal may name a third party (a partner that holds the document): the ERP text is shown only for the known-safe required-field code.
        return { code: 'erp_refused', message: GENERIC_REFUSAL };
    }
  }
  // Parked for a person (the ERP answer did not match, or the outcome is unknown): not a refusal, the seller waits.
  if (status === 'unknown' && outbox !== null && outbox.nextAttemptAt === null) {
    return { code: 'review_needed', message: 'O Sankhya ainda não confirmou este cadastro; ele está em verificação pelo backoffice.' };
  }
  return null;
}

/** CUST-RT: the only thing a client shows about delivery. A refused row is never shown (the refusal is a 422 at request time). */
export function sendStateOf(status: string): 'sent' | 'pending' {
  return status === 'confirmed' ? 'sent' : 'pending';
}

/** Words of an ERP refusal text -> the request field it is about (conservative; anything else is general, key `_`). */
const FIELD_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/vendedor/i, 'sellerCode'],
  [/cpf|cnpj|documento/i, 'document'],
  [/inscri[cç][aã]o estadual|\bIE\b/i, 'stateRegistration'],
  [/e-?mail/i, 'email'],
  [/telefone|fone/i, 'phone'],
  [/\bcep\b|endere[cç]o|logradouro|bairro/i, 'addresses'],
  [/raz[aã]o social|\bnome\b/i, 'name'],
];

/**
 * The field -> pt-BR text map of a definitive refusal (422 `customer_refused`). Reasons come from `reasonOfRegistration`, so a duplicate
 * keeps the generic text and no third-party data. The field is a hint from the words of the ERP text; unknown = `_`.
 */
export function refusalFields(reason: { readonly code: ReasonCode; readonly message: string } | null): Record<string, string> {
  const message = reason?.message ?? GENERIC_REFUSAL;
  if (reason?.code === 'document_already_registered') return { document: message };
  if (reason?.code === 'required_field') {
    const hint = FIELD_HINTS.find(([pattern]) => pattern.test(message));
    return { [hint?.[1] ?? '_']: message };
  }
  return { _: message };
}

export function toRegistrationView(row: RegistrationFacts, outbox: RegistrationOutboxFacts | null): CustomerRegistrationView {
  const reason = reasonOfRegistration(row.status, row.rejectionCode, outbox);
  return {
    registrationId: row.id,
    state: stateOfRegistration(row.status),
    stateLabel: customerStateLabel(stateOfRegistration(row.status)),
    sendState: sendStateOf(row.status),
    status: row.status as CustomerRegistrationView['status'],
    customerCode: row.erpCustomerCode,
    originKey: row.originKey,
    document: row.taxId,
    name: row.name,
    sellerCode: row.sellerCode,
    reasonCode: reason?.code ?? null,
    reasonMessage: reason?.message ?? null,
    correctsRegistrationId: row.correctsRegistrationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
