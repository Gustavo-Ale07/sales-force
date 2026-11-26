import type { ImportMapping, ImportType } from '@salesforce/contracts';

/** The fields a file column can feed, per import type, and the by-name suggestion of the mapping (RF-IMP-2 step 2). */

export interface ImportFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  /** Normalised header names (no accents, lower case, letters and digits only) that suggest this field. */
  readonly aliases: readonly string[];
}

export const ORDER_ITEM_FIELDS: readonly ImportFieldDefinition[] = [
  { id: 'product', label: 'Código do produto', required: true, aliases: ['codigo', 'cod', 'codigodoproduto', 'codproduto', 'produto', 'codigoproduto', 'sku', 'referencia', 'ref'] },
  { id: 'quantity', label: 'Quantidade', required: true, aliases: ['quantidade', 'qtd', 'qtde', 'quant', 'qty', 'quantity'] },
];

export const CUSTOMER_FIELDS: readonly ImportFieldDefinition[] = [
  { id: 'document', label: 'CPF/CNPJ', required: true, aliases: ['cpfcnpj', 'cnpjcpf', 'cpf', 'cnpj', 'documento', 'doc'] },
  { id: 'name', label: 'Nome ou razão social', required: true, aliases: ['nome', 'razaosocial', 'nomerazaosocial', 'cliente', 'razao'] },
  { id: 'tradeName', label: 'Nome fantasia', required: false, aliases: ['fantasia', 'nomefantasia'] },
  { id: 'phone', label: 'Telefone', required: false, aliases: ['telefone', 'fone', 'celular', 'tel'] },
  { id: 'email', label: 'E-mail', required: false, aliases: ['email', 'emailcontato'] },
  { id: 'stateRegistration', label: 'Inscrição estadual', required: false, aliases: ['ie', 'inscricaoestadual', 'inscestadual'] },
  { id: 'postalCode', label: 'CEP', required: false, aliases: ['cep', 'codigopostal'] },
  { id: 'number', label: 'Número', required: false, aliases: ['numero', 'num', 'nro'] },
  { id: 'complement', label: 'Complemento', required: false, aliases: ['complemento', 'compl'] },
  { id: 'sellerCode', label: 'Código do vendedor', required: false, aliases: ['vendedor', 'codigovendedor', 'codvendedor'] },
];

export function fieldsOf(type: ImportType): readonly ImportFieldDefinition[] {
  return type === 'customers' ? CUSTOMER_FIELDS : ORDER_ITEM_FIELDS;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** One column per field, first match by alias priority; a column already taken by another field is not reused. */
export function suggestMapping(type: ImportType, headers: readonly string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: Record<string, string | null> = {};
  for (const field of fieldsOf(type)) {
    let found = -1;
    for (const alias of field.aliases) {
      const index = normalized.findIndex((header, position) => header === alias && !taken.has(position));
      if (index >= 0) {
        found = index;
        break;
      }
    }
    if (found >= 0) taken.add(found);
    mapping[field.id] = found >= 0 ? (headers[found] ?? null) : null;
  }
  return mapping;
}

/** The mapping in force: the client's, restricted to known fields and real headers; otherwise the suggestion. */
export function effectiveMapping(type: ImportType, headers: readonly string[], requested: ImportMapping | undefined): ImportMapping {
  if (requested === undefined) return suggestMapping(type, headers);
  const mapping: Record<string, string | null> = {};
  for (const field of fieldsOf(type)) {
    const header = requested[field.id];
    mapping[field.id] = header !== undefined && header !== null && headers.includes(header) ? header : null;
  }
  return mapping;
}

export function missingRequired(type: ImportType, mapping: ImportMapping): string[] {
  return fieldsOf(type)
    .filter((field) => field.required && (mapping[field.id] ?? null) === null)
    .map((field) => field.id);
}

/** Cell text of a field in a row (empty when the field has no column). */
export function valueOf(headers: readonly string[], cells: readonly string[], mapping: ImportMapping, fieldId: string): string {
  const header = mapping[fieldId];
  if (header === null || header === undefined) return '';
  const index = headers.indexOf(header);
  return index < 0 ? '' : (cells[index] ?? '').trim();
}
