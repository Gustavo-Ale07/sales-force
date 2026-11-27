import { Inject, Injectable } from '@nestjs/common';
import {
  CreateCustomerRequestSchema,
  IMPORT_MAX_CUSTOMER_ROWS,
  IMPORT_MAX_REPORTED_ERRORS,
  IMPORT_PREVIEW_ROWS,
  ProductsQuerySchema,
  type CreateCustomerRequest,
  type ImportConfirmRequest,
  type ImportPreview,
  type ImportPreviewRequest,
  type ImportResult,
  type ImportRowIssue,
  type ImportType,
  type ProductListItem,
} from '@salesforce/contracts';
import { prepareCustomerRegistration } from '../customers/customer-registration-request.js';
import { GENERIC_DUPLICATE_MESSAGE, MAX_CUSTOMER_CREATIONS_PER_HOUR, CustomerRegistrationService } from '../customers/customer-registration.service.js';
import { CustomerRegistrationRepository } from '../customers/customer-registration.repository.js';
import { PostalCodeService } from '../customers/postal-code.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { OrdersService } from '../orders/orders.service.js';
import { effectiveMapping, fieldsOf, missingRequired, valueOf } from './import-fields.js';
import {
  MAX_ORDER_LINES_PER_IMPORT,
  customerRequestOf,
  customerRowRequestId,
  documentDigits,
  onlyDigits,
  readQuantity,
  type CustomerRowText,
} from './import-rows.js';
import { ImportFileError, decodeImportFile, importFailureMessages, parseSpreadsheet, type Spreadsheet } from './spreadsheet.js';

const RESOLVE_CHUNK = 500;
const MAX_IDENTIFIER_LENGTH = 40;

interface RowOutcome {
  readonly row: number;
  readonly ok: boolean;
  readonly label: string | null;
  readonly quantity: string | null;
  readonly reason: string | null;
}

interface OrderClassification {
  readonly outcomes: readonly RowOutcome[];
  readonly items: readonly { readonly productCode: number; readonly quantity: string }[];
  readonly skippedBlank: number;
}

interface CustomerClassification {
  readonly outcomes: readonly RowOutcome[];
  /** Ready-to-send requests, by file row. */
  readonly requests: readonly { readonly row: number; readonly request: CreateCustomerRequest }[];
}

interface Loaded {
  readonly sheet: Spreadsheet;
  readonly mapping: ImportPreview['mapping'];
  readonly missing: string[];
}

/**
 * Spreadsheet import (RF-IMP). Orchestration only: file safety lives in `spreadsheet.ts`, row rules in `import-rows.ts`, and the
 * writes go through the services that already own them (`OrdersService.create` for the quotation, `CustomerRegistrationService.create`
 * for customers), so authorization, scope, prices, the dataset guard and the ERP delivery path are the ones of the manual flows.
 * Nothing about the file content is logged or audited.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CustomerRegistrationService) private readonly registrations: CustomerRegistrationService,
    @Inject(CustomerRegistrationRepository) private readonly registrationRepository: CustomerRegistrationRepository,
    @Inject(PostalCodeService) private readonly postalCodes: PostalCodeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- preview ---------- */

  async preview(user: CurrentUser, request: ImportPreviewRequest): Promise<ImportPreview> {
    const loaded = await this.load(request);
    const base = { type: request.type, fields: fieldsOf(request.type).map(({ id, label, required }) => ({ id, label, required })), headers: [...loaded.sheet.headers], mapping: loaded.mapping, missingRequired: loaded.missing };
    if (loaded.missing.length > 0) {
      return { ...base, totalRows: loaded.sheet.rows.length, recognized: 0, rejected: 0, skippedBlank: 0, sample: [], errors: [], errorsTruncated: false };
    }
    const { outcomes, skippedBlank } =
      request.type === 'order_items'
        ? await this.classifyOrder(user, request.customerCode, loaded)
        : await this.classifyCustomers(user, loaded, 'preview');
    return { ...base, ...summarize(outcomes, loaded.sheet.rows.length, skippedBlank) };
  }

  /* ---------- confirm ---------- */

  async confirm(user: CurrentUser, request: ImportConfirmRequest): Promise<ImportResult> {
    const loaded = await this.load(request);
    if (loaded.missing.length > 0) throw refused('mapping', 'import_mapping_incomplete', 'Associe as colunas obrigatórias antes de confirmar.');
    const result = request.type === 'order_items' ? await this.confirmOrder(user, request, loaded) : await this.confirmCustomers(user, request, loaded);
    await this.audit.record({
      action: AUDIT_ACTIONS.importCompleted,
      actorAccountId: user.accountId,
      detail: { type: request.type, rows: loaded.sheet.rows.length, created: result.created, rejected: result.rejected, channel: user.channel },
    });
    return result;
  }

  private async confirmOrder(user: CurrentUser, request: ImportConfirmRequest, loaded: Loaded): Promise<ImportResult> {
    if (request.expectedDataset === undefined) throw refused('expectedDataset', 'required', 'Dados da instalação ausentes. Atualize a tela e tente de novo.');
    const customerCode = requireCustomer(request.customerCode);
    const classified = await this.classifyOrder(user, customerCode, loaded);
    if (classified.items.length === 0) {
      throw new AppError('conflict', { message: 'Nenhuma linha reconhecida para importar.', details: { reason: 'import_nothing_to_import' } });
    }
    const context = await this.policy.accessContext(user);
    const quotationTop = context.configuration.sales.quotationTopCode;
    if (quotationTop === null) {
      throw new AppError('conflict', { message: 'O orçamento ainda não está configurado nesta instalação.', details: { reason: 'quotation_top_not_configured' } });
    }
    const { order } = await this.orders.create(user, {
      clientRequestId: request.clientRequestId,
      expectedDataset: request.expectedDataset,
      customerCode,
      topCode: quotationTop,
      negotiationTypeCode: null,
      notes: null,
      items: classified.items.map((item) => ({ productCode: item.productCode, quantity: item.quantity })),
    });
    const summary = summarize(classified.outcomes, loaded.sheet.rows.length, classified.skippedBlank);
    return {
      type: 'order_items',
      created: classified.items.length,
      rejected: summary.rejected,
      pending: 0,
      skippedBlank: classified.skippedBlank,
      orderId: order.id,
      draftNumber: order.draftNumber,
      errors: summary.errors,
      errorsTruncated: summary.errorsTruncated,
    };
  }

  private async confirmCustomers(user: CurrentUser, request: ImportConfirmRequest, loaded: Loaded): Promise<ImportResult> {
    const classified = await this.classifyCustomers(user, loaded, 'confirm', request.clientRequestId);
    const failures = new Map<number, string>();
    for (const outcome of classified.outcomes) if (!outcome.ok && outcome.reason !== null) failures.set(outcome.row, outcome.reason);
    let created = 0;
    let pending = 0;
    // One row at a time through the manual registration path: its own seller rules, duplicate check, hourly budget and ERP outbox.
    for (const { row, request: body } of classified.requests) {
      try {
        const { httpStatus } = await this.registrations.create(user, body);
        created += 1;
        if (httpStatus === 202) pending += 1;
      } catch (error) {
        failures.set(row, reasonOf(error));
      }
    }
    const errors = [...failures.entries()].sort((a, b) => a[0] - b[0]).map(([row, reason]) => ({ row, reason }));
    return {
      type: 'customers',
      created,
      rejected: errors.length,
      pending,
      skippedBlank: 0,
      orderId: null,
      draftNumber: null,
      errors: errors.slice(0, IMPORT_MAX_REPORTED_ERRORS),
      errorsTruncated: errors.length > IMPORT_MAX_REPORTED_ERRORS,
    };
  }

  /* ---------- file ---------- */

  private async load(request: ImportPreviewRequest): Promise<Loaded> {
    let sheet: Spreadsheet;
    try {
      const { kind, bytes } = decodeImportFile(request.fileName, request.contentBase64);
      sheet = await parseSpreadsheet(kind, bytes);
    } catch (error) {
      if (error instanceof ImportFileError) throw refused('file', error.code, importFailureMessages[error.code]);
      throw refused('file', 'import_file_unreadable', importFailureMessages.import_file_unreadable);
    }
    const mapping = effectiveMapping(request.type, sheet.headers, request.mapping);
    return { sheet, mapping, missing: missingRequired(request.type, mapping) };
  }

  /* ---------- order lines ---------- */

  private async classifyOrder(user: CurrentUser, customerCodeInput: number | undefined, loaded: Loaded): Promise<OrderClassification> {
    const customerCode = requireCustomer(customerCodeInput);
    const { sheet, mapping } = loaded;
    const rows = sheet.rows.map((row) => ({
      row: row.line,
      identifier: valueOf(sheet.headers, row.cells, mapping, 'product'),
      quantityText: valueOf(sheet.headers, row.cells, mapping, 'quantity'),
    }));
    // Only rows that name a product with a quantity are resolved; blank-quantity rows are template lines nobody filled.
    const wanted = rows.filter((entry) => entry.identifier !== '' && entry.quantityText !== '' && entry.identifier.length <= MAX_IDENTIFIER_LENGTH);
    const distinct = [...new Set(wanted.map((entry) => entry.identifier))];
    const found = new Map<string, Awaited<ReturnType<CatalogService['resolve']>>['items'][number]>();
    for (let start = 0; start < distinct.length; start += RESOLVE_CHUNK) {
      const chunk = distinct.slice(start, start + RESOLVE_CHUNK);
      const answer = await this.catalog.resolve(user, { customerCode, identifiers: chunk });
      for (const item of answer.items) found.set(item.identifier, item);
    }

    const outcomes: RowOutcome[] = [];
    const items: { productCode: number; quantity: string }[] = [];
    let skippedBlank = 0;
    for (const entry of rows) {
      const fail = (reason: string): void => {
        outcomes.push({ row: entry.row, ok: false, label: entry.identifier === '' ? null : entry.identifier, quantity: entry.quantityText === '' ? null : entry.quantityText, reason });
      };
      if (entry.identifier === '') {
        fail('Código do produto em branco.');
        continue;
      }
      if (entry.quantityText === '') {
        skippedBlank += 1;
        continue;
      }
      if (entry.identifier.length > MAX_IDENTIFIER_LENGTH) {
        fail('Código do produto inválido.');
        continue;
      }
      const answer = found.get(entry.identifier);
      if (answer === undefined || answer.status === 'not_found') {
        fail('Código inexistente.');
        continue;
      }
      if (answer.status === 'ambiguous') {
        fail('Código ambíguo: mais de um produto corresponde.');
        continue;
      }
      const product: ProductListItem | undefined = answer.product;
      if (product === undefined) {
        fail("Código inexistente.");
        continue;
      }
      if (!product.sellable || !product.active) {
        fail('Produto não vendável.');
        continue;
      }
      const quantity = readQuantity(entry.quantityText, product.quantityStep);
      if (quantity.kind !== 'ok') {
        fail(quantity.kind === 'invalid' ? quantity.reason : 'Quantidade inválida.');
        continue;
      }
      if (items.length >= MAX_ORDER_LINES_PER_IMPORT) {
        fail(`Limite de ${MAX_ORDER_LINES_PER_IMPORT} itens por orçamento.`);
        continue;
      }
      items.push({ productCode: product.code, quantity: quantity.value });
      outcomes.push({ row: entry.row, ok: true, label: `${product.code} - ${product.description}`, quantity: quantity.value, reason: null });
    }
    return { outcomes, items, skippedBlank };
  }

  /* ---------- customers ---------- */

  private async classifyCustomers(
    user: CurrentUser,
    loaded: Loaded,
    mode: 'preview' | 'confirm',
    confirmId = '00000000-0000-4000-8000-000000000000',
  ): Promise<CustomerClassification & { skippedBlank: number }> {
    const { sheet, mapping } = loaded;
    const scope = await this.policy.customerScope(user);
    const actor = {
      role: user.role,
      sellerCodes: user.sellerCodes,
      allowedSellerCodes: scope.kind === 'sellers' ? scope.sellerCodes : null,
    };
    const defaultPriceTableCode = await this.registrationRepository.defaultPriceTableCode();
    const outcomes: RowOutcome[] = [];
    const requests: { row: number; request: CreateCustomerRequest }[] = [];
    const seen = new Map<string, number>();
    let counted = 0;

    for (const line of sheet.rows) {
      const text = (id: string): string => valueOf(sheet.headers, line.cells, mapping, id);
      const row: CustomerRowText = {
        document: text('document'),
        name: text('name'),
        tradeName: text('tradeName'),
        phone: text('phone'),
        email: text('email'),
        stateRegistration: text('stateRegistration'),
        postalCode: text('postalCode'),
        number: text('number'),
        complement: text('complement'),
        sellerCode: text('sellerCode'),
      };
      const label = row.name === '' ? null : row.name;
      const fail = (reason: string): void => {
        outcomes.push({ row: line.line, ok: false, label, quantity: null, reason });
      };

      const digits = documentDigits(row.document);
      const previous = seen.get(digits);
      if (digits !== '' && previous !== undefined) {
        fail(`CPF/CNPJ repetido na planilha (linha ${previous}).`);
        continue;
      }
      if (digits !== '') seen.set(digits, line.line);
      counted += 1;
      if (counted > IMPORT_MAX_CUSTOMER_ROWS) {
        fail(`Limite de ${IMPORT_MAX_CUSTOMER_ROWS} clientes por importação. Envie as demais linhas em outro arquivo.`);
        continue;
      }

      const draft = CreateCustomerRequestSchema.safeParse({
        ...customerRequestOf(row, customerRowRequestId(confirmId, line.line)),
        addresses: [],
      });
      if (!draft.success) {
        fail(firstZodMessage(draft.error.issues));
        continue;
      }
      const prepared = prepareCustomerRegistration(draft.data, actor, defaultPriceTableCode);
      if (!prepared.ok) {
        fail(prepared.issues[0]?.message ?? 'Dados inválidos.');
        continue;
      }
      if (await this.documentTaken(user, prepared.value.payload.document)) {
        fail(GENERIC_DUPLICATE_MESSAGE);
        continue;
      }

      const address = await this.addressOf(user, row);
      if (address.error !== null) {
        fail(address.error);
        continue;
      }
      const withAddress = CreateCustomerRequestSchema.safeParse({ ...draft.data, addresses: address.addresses });
      if (!withAddress.success) {
        fail(firstZodMessage(withAddress.error.issues));
        continue;
      }
      requests.push({ row: line.line, request: withAddress.data });
      outcomes.push({ row: line.line, ok: true, label, quantity: null, reason: null });
    }
    void mode;
    return { outcomes, requests, skippedBlank: 0 };
  }

  /**
   * Existence of a document is information: it is answered only with the generic text and spends the same hourly budget
   * (and leaves the same refusal record) as the manual registration, so the preview is no free lookup oracle.
   */
  private async documentTaken(user: CurrentUser, document: string): Promise<boolean> {
    const at = this.clock();
    const since = new Date(at.getTime() - 3_600_000);
    if ((await this.registrationRepository.countSince(user.accountId, since)) >= MAX_CUSTOMER_CREATIONS_PER_HOUR) {
      throw new AppError('rate_limited', { retryAfterSeconds: 600 });
    }
    if ((await this.registrationRepository.findDocumentHolder(document)) === null) return false;
    const refusalId = uuidv7(at.getTime());
    await this.registrationRepository.transaction(async (tx) => {
      await this.registrationRepository.recordRefusal({ id: refusalId, accountId: user.accountId, reason: 'document_already_registered', at }, tx);
      await this.audit.record({ action: AUDIT_ACTIONS.customerRegistrationRefused, actorAccountId: user.accountId, detail: { refusalId, reason: 'document_already_registered' } }, tx);
    });
    return true;
  }

  private async addressOf(user: CurrentUser, row: CustomerRowText): Promise<{ addresses: unknown[]; error: string | null }> {
    if (row.postalCode === '') return { addresses: [], error: null };
    const cep = onlyDigits(row.postalCode);
    if (!/^\d{8}$/.test(cep)) return { addresses: [], error: 'CEP inválido.' };
    let found;
    try {
      found = await this.postalCodes.lookupForImport(user, cep);
    } catch {
      return { addresses: [], error: 'Não foi possível consultar o CEP agora. Tente novamente.' };
    }
    if (!found.found || found.cityCode === null) return { addresses: [], error: 'CEP não encontrado ou cidade fora do cadastro.' };
    return {
      error: null,
      addresses: [
        {
          cityCode: found.cityCode,
          streetCode: found.streetCode ?? 0,
          neighborhoodCode: found.neighborhoodCode ?? 0,
          streetName: found.streetCode === null ? found.street : null,
          neighborhoodName: found.neighborhoodCode === null ? found.neighborhood : null,
          number: row.number === '' ? null : row.number,
          complement: row.complement === '' ? null : row.complement,
          postalCode: cep,
        },
      ],
    };
  }

  /* ---------- template ---------- */

  /** Sellable products for the template, in description order. No price, cost or margin is read into the sheet. */
  async templateProducts(user: CurrentUser): Promise<ProductListItem[]> {
    const products: ProductListItem[] = [];
    for (let page = 1; page <= 400; page += 1) {
      const query = ProductsQuerySchema.parse({ sellable: 'true', sort: 'description', page: String(page), pageSize: '100' });
      const answer = await this.catalog.list(user, query);
      products.push(...answer.items.filter((item) => item.sellable && item.active));
      if (answer.page * answer.pageSize >= answer.total || answer.items.length === 0) break;
    }
    return products;
  }
}

export type { ImportType };

function requireCustomer(code: number | undefined): number {
  if (code === undefined) throw refused('customerCode', 'required', 'Escolha o cliente do orçamento.');
  return code;
}

function refused(path: string, code: string, message: string): AppError {
  return new AppError('validation_failed', { message, details: { issues: [{ path, code, message }] } });
}

function firstZodMessage(issues: readonly { message: string; path: readonly PropertyKey[] }[]): string {
  const [first] = issues;
  if (first === undefined) return 'Dados inválidos.';
  const field: Record<string, string> = { document: 'CPF/CNPJ', name: 'Nome', email: 'E-mail', phone: 'Telefone', stateRegistration: 'Inscrição estadual', tradeName: 'Nome fantasia' };
  const key = String(first.path[0] ?? '');
  const prefix = field[key] ?? (key === 'addresses' ? 'Endereço' : '');
  return prefix === '' ? first.message : `${prefix}: ${first.message}`;
}

/** The text of a refusal from the registration path, already in pt-BR. */
function reasonOf(error: unknown): string {
  if (error instanceof AppError) {
    const fields = (error.details as { fields?: Record<string, string> } | undefined)?.fields;
    const first = fields === undefined ? undefined : Object.values(fields)[0];
    if (first !== undefined) return first;
    return error.message;
  }
  return 'Não foi possível cadastrar este cliente.';
}

function summarize(outcomes: readonly RowOutcome[], totalRows: number, skippedBlank: number) {
  const failed = outcomes.filter((outcome) => !outcome.ok);
  const issues: ImportRowIssue[] = failed.map((outcome) => ({ row: outcome.row, reason: outcome.reason ?? 'Linha não reconhecida.' }));
  return {
    totalRows,
    recognized: outcomes.length - failed.length,
    rejected: failed.length,
    skippedBlank,
    sample: outcomes.slice(0, IMPORT_PREVIEW_ROWS).map((outcome) => ({ ...outcome })),
    errors: issues.slice(0, IMPORT_MAX_REPORTED_ERRORS),
    errorsTruncated: issues.length > IMPORT_MAX_REPORTED_ERRORS,
  };
}
