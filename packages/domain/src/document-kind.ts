/**
 * Document kind (J3, D-T): the header TOP decides whether a seller is working on a quote ("orçamento") or an
 * order ("pedido"). Pure; the TOP lists come only from configuration.
 */
export type DocumentKind = 'order' | 'quote';

export interface DocumentTopRules {
  /** `sales.quoteTopCodes` (group ORÇAMENTO). */
  readonly quoteTopCodes?: readonly number[] | undefined;
  /** `sales.quotationTopCode`. */
  readonly quotationTopCode?: number | null | undefined;
}

export function documentKindOf(topCode: number | null | undefined, rules: DocumentTopRules): DocumentKind {
  if (topCode === null || topCode === undefined) return 'order';
  if (rules.quoteTopCodes?.includes(topCode) === true) return 'quote';
  if (rules.quotationTopCode !== null && rules.quotationTopCode !== undefined && rules.quotationTopCode === topCode) return 'quote';
  return 'order';
}

export interface DocumentVocabulary {
  readonly save: string;
  readonly send: string;
  /** "Pedido nº N" / "Orçamento nº N". */
  readonly title: string;
  /** Upper-case variant for the printed document. */
  readonly heading: string;
  readonly notSent: string;
}

export function documentVocabulary(kind: DocumentKind, number: number | string | null): DocumentVocabulary {
  const suffix = number === null ? '' : ` nº ${number}`;
  const noun = kind === 'quote' ? 'Orçamento' : 'Pedido';
  return {
    save: kind === 'quote' ? 'Confirmar orçamento' : 'Confirmar pedido',
    send: kind === 'quote' ? 'Enviar orçamento ao Sankhya' : 'Enviar ao Sankhya',
    title: `${noun}${suffix}`,
    heading: `${noun.toUpperCase()}${suffix.toUpperCase()}`,
    notSent: 'não enviado',
  };
}
