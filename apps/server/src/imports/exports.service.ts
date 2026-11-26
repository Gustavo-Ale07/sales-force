import { Inject, Injectable } from '@nestjs/common';
import {
  CustomersQuerySchema,
  EXPORT_MAX_ROWS,
  OrdersQuerySchema,
  ProductsQuerySchema,
  type ExportCustomersQuery,
  type ExportFormat,
  type ExportOrdersQuery,
  type ExportProductsQuery,
} from '@salesforce/contracts';
import { CatalogService } from '../catalog/catalog.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { OrdersService } from '../orders/orders.service.js';
import { AppError } from '../http/app-error.js';
import { render, type Table } from './tabular.js';
import { ImportsService } from './imports.service.js';

const PAGE_SIZE = 100;

export interface ExportFile {
  readonly body: Buffer;
  readonly format: ExportFormat;
  readonly fileName: string;
}

interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * Exports of the lists the user already sees (RF-DSH-6). The rows come from the same scoped list services, so the data scope is
 * the one of the screen; the routes exist only for internal profiles (central policy, default deny). Cost, margin and prices are
 * never part of an export. Every export is audited with the resource, the format and the row count (never the content).
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ImportsService) private readonly imports: ImportsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async customersFile(user: CurrentUser, query: ExportCustomersQuery): Promise<ExportFile> {
    const rows = await collect((page) =>
      this.customers.list(
        user,
        CustomersQuerySchema.parse({
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(query.sellerCode === undefined ? {} : { sellerCode: String(query.sellerCode) }),
          page: String(page),
          pageSize: String(PAGE_SIZE),
        }),
      ),
    );
    const table: Table = {
      sheet: 'Clientes',
      headers: ['Código', 'Nome', 'Nome fantasia', 'CPF/CNPJ', 'Ativo', 'Bloqueado', 'Código do vendedor', 'Vendedor'],
      rows: rows.map((row) => [row.code, row.name, row.tradeName, row.document, row.active, row.blocked, row.sellerCode, row.sellerName]),
      widths: [10, 40, 30, 20, 8, 10, 12, 28],
    };
    return this.finish(user, 'customers', query.format, table, rows.length);
  }

  async ordersFile(user: CurrentUser, query: ExportOrdersQuery): Promise<ExportFile> {
    const rows = await collect((page) =>
      this.orders.list(
        user,
        OrdersQuerySchema.parse({
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(query.customerCode === undefined ? {} : { customerCode: String(query.customerCode) }),
          page: String(page),
          pageSize: String(PAGE_SIZE),
        }),
      ),
    );
    const table: Table = {
      sheet: 'Pedidos',
      headers: ['Rascunho', 'Pedido ERP', 'Código do cliente', 'Cliente', 'Código do vendedor', 'Status', 'TOP', 'Itens', 'Total estimado'],
      rows: rows.map((row) => [row.draftNumber, row.erpNumber, row.customerCode, row.customerName, row.sellerCode, row.status, row.topCode, row.itemCount, row.estimatedTotal]),
      widths: [10, 12, 12, 40, 12, 18, 8, 8, 16],
    };
    return this.finish(user, 'orders', query.format, table, rows.length);
  }

  async productsFile(user: CurrentUser, query: ExportProductsQuery): Promise<ExportFile> {
    const rows = await collect((page) =>
      this.catalog.list(
        user,
        ProductsQuerySchema.parse({
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(query.group === undefined ? {} : { group: String(query.group) }),
          page: String(page),
          pageSize: String(PAGE_SIZE),
        }),
      ),
    );
    const table: Table = {
      sheet: 'Produtos',
      headers: ['Código', 'Descrição', 'Unidade', 'Referência', 'Marca', 'Grupo', 'Ativo', 'Vendável'],
      rows: rows.map((row) => [row.code, row.description, row.unit, row.reference, row.brand, row.groupName, row.active, row.sellable]),
      widths: [10, 50, 8, 18, 18, 24, 8, 10],
    };
    return this.finish(user, 'products', query.format, table, rows.length);
  }

  /** Template of the order-line import: the sellable products and an empty quantity column. No price, cost or margin. */
  async orderTemplate(user: CurrentUser): Promise<ExportFile> {
    const products = await this.imports.templateProducts(user);
    const table: Table = {
      sheet: 'Produtos',
      headers: ['Código', 'Descrição', 'Unidade', 'Referência', 'Quantidade'],
      rows: products.map((product) => [product.code, product.description, product.unit, product.reference, null]),
      widths: [10, 50, 8, 18, 12],
    };
    return { body: await render(table, 'xlsx'), format: 'xlsx', fileName: 'modelo-importacao-itens.xlsx' };
  }

  private async finish(user: CurrentUser, resource: string, format: ExportFormat, table: Table, count: number): Promise<ExportFile> {
    const body = await render(table, format);
    await this.audit.record({
      action: AUDIT_ACTIONS.dataExported,
      actorAccountId: user.accountId,
      detail: { resource, format, rows: count, channel: user.channel },
    });
    return { body, format, fileName: `${resource}.${format}` };
  }
}

async function collect<T>(fetchPage: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await fetchPage(page);
    rows.push(...answer.items);
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new AppError('conflict', { message: `A exportação passa de ${EXPORT_MAX_ROWS} linhas. Refine o filtro.`, details: { reason: 'export_too_large' } });
    }
    if (answer.items.length === 0 || page * answer.pageSize >= answer.total) return rows;
  }
}
