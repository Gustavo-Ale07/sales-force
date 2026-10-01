import type { z } from 'zod';
import { LoginRequestSchema, LoginResponseSchema, SessionResponseSchema } from './auth.js';
import {
  ProductDetailQuerySchema,
  ProductDetailSchema,
  ProductGroupsResponseSchema,
  ProductPathSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
  ResolveProductsRequestSchema,
  ResolveProductsResponseSchema,
} from './catalog.js';
import { ConfigurationResponseSchema, OrderEntryConfigurationSchema } from './configuration.js';
import {
  CustomerDetailSchema,
  CustomerPathSchema,
  CustomersQuerySchema,
  CustomersResponseSchema,
} from './customers.js';
import { DashboardResponseSchema } from './dashboard.js';
import { ErpSubmissionDisabledErrorSchema, type ErrorStatus } from './errors.js';
import { HealthResponseSchema, ReadyResponseSchema } from './health.js';
import {
  CreateOrderRequestSchema,
  OrderDetailSchema,
  OrderPathSchema,
  OrdersQuerySchema,
  OrdersResponseSchema,
  ReplaceOrderRequestSchema,
  RepeatLastOrderRequestSchema,
} from './orders.js';
import { SellersQuerySchema, SellersResponseSchema } from './sellers.js';
import {
  CreateOrderTemplateRequestSchema,
  OrderTemplateDetailSchema,
  OrderTemplatePathSchema,
  OrderTemplatesResponseSchema,
  ReplaceOrderTemplateRequestSchema,
  RepeatLastOrderResponseSchema,
  UseOrderTemplateRequestSchema,
  UseOrderTemplateResponseSchema,
} from './templates.js';

/**
 * Route registry: the single source for HTTP method, path, request/response schemas, operation id,
 * tags and auth requirement. The OpenAPI document is generated from it, and the server binds its
 * controllers to it, so nothing is described twice (STACK-4).
 *
 * `path` uses OpenAPI syntax (`/customers/{code}`) relative to `API_BASE_PATH`.
 */
export const API_BASE_PATH = '/api/v1';
export const SESSION_COOKIE_NAME = 'sf_session';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';
export type RouteAuth = 'public' | 'session';

export interface RouteResponse {
  readonly description: string;
  /** Omitted for responses without a body (e.g. 204). */
  readonly schema?: z.ZodType;
}

export interface RouteRequest {
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  readonly body?: z.ZodType;
}

export interface RouteDefinition {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly tags: readonly string[];
  readonly summary: string;
  readonly description?: string;
  readonly auth: RouteAuth;
  readonly request: RouteRequest;
  /** Request body cap for this route, in bytes; the server enforces it. Omitted = the API-wide limit. */
  readonly maxBodyBytes?: number;
  /** Documented success (and specific error) responses by HTTP status. */
  readonly responses: Readonly<Record<number, RouteResponse>>;
  /** Generic error statuses; their body is always `ApiError`. */
  readonly errors: readonly ErrorStatus[];
}

function defineRoute<const R extends RouteDefinition>(route: R): R {
  return route;
}

export const routes = {
  getHealth: defineRoute({
    operationId: 'getHealth',
    method: 'get',
    path: '/health',
    tags: ['platform'],
    summary: 'Liveness',
    description: 'The process is up. Does not check the database or the integration.',
    auth: 'public',
    request: {},
    responses: { 200: { description: 'API no ar', schema: HealthResponseSchema } },
    errors: [],
  }),
  getReady: defineRoute({
    operationId: 'getReady',
    method: 'get',
    path: '/ready',
    tags: ['platform'],
    summary: 'Readiness',
    description:
      'Database, migration level and integration summary. A degraded integration does not make the API not ready.',
    auth: 'public',
    request: {},
    responses: {
      200: { description: 'Pronta (ready) ou degradada (degraded)', schema: ReadyResponseSchema },
      503: { description: 'Não pronta (not_ready)', schema: ReadyResponseSchema },
    },
    errors: [],
  }),

  login: defineRoute({
    operationId: 'login',
    method: 'post',
    path: '/auth/login',
    tags: ['auth'],
    summary: 'Sign in',
    description: 'Sets the HttpOnly session cookie. The response body carries no token.',
    auth: 'public',
    request: { body: LoginRequestSchema },
    responses: { 200: { description: 'Sessão criada', schema: LoginResponseSchema } },
    errors: [400, 401, 429, 503],
  }),
  logout: defineRoute({
    operationId: 'logout',
    method: 'post',
    path: '/auth/logout',
    tags: ['auth'],
    summary: 'Sign out',
    auth: 'session',
    request: {},
    responses: { 204: { description: 'Sessão encerrada' } },
    errors: [401],
  }),
  getSession: defineRoute({
    operationId: 'getSession',
    method: 'get',
    path: '/auth/session',
    tags: ['auth'],
    summary: 'Current session',
    description: 'Always 200: `authenticated` tells whether a valid session exists.',
    auth: 'public',
    request: {},
    responses: { 200: { description: 'Estado da sessão', schema: SessionResponseSchema } },
    errors: [],
  }),

  getConfiguration: defineRoute({
    operationId: 'getConfiguration',
    method: 'get',
    path: '/configuration',
    tags: ['configuration'],
    summary: 'Installation configuration summary and integration state',
    description: 'Client-safe snapshot summary, sync states, gateway mode. Never contains secrets.',
    auth: 'session',
    request: {},
    responses: {
      200: { description: 'Configuração vigente', schema: ConfigurationResponseSchema },
    },
    errors: [401, 403, 503],
  }),

  getOrderEntryConfiguration: defineRoute({
    operationId: 'getOrderEntryConfiguration',
    method: 'get',
    path: '/order-entry/configuration',
    tags: ['configuration'],
    summary: 'Minimal configuration slice for the order-entry screen',
    description:
      'Only the fields order-editor needs (general.enabled, sales.negotiationTypes/defaultNegotiationTypeCode/orderBehavior, products.productWithoutPrice.orderable). Never the admin-only /configuration payload.',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Configuração mínima do fluxo de pedido', schema: OrderEntryConfigurationSchema } },
    errors: [401, 403, 503],
  }),

  getDashboard: defineRoute({
    operationId: 'getDashboard',
    method: 'get',
    path: '/dashboard',
    tags: ['dashboard'],
    summary: 'Dashboard KPIs within the actor scope',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Indicadores', schema: DashboardResponseSchema } },
    errors: [401, 403],
  }),

  listSellers: defineRoute({
    operationId: 'listSellers',
    method: 'get',
    path: '/sellers',
    tags: ['sellers'],
    summary: 'List sellers visible to the actor',
    auth: 'session',
    request: { query: SellersQuerySchema },
    responses: { 200: { description: 'Vendedores', schema: SellersResponseSchema } },
    errors: [400, 401, 403],
  }),

  listCustomers: defineRoute({
    operationId: 'listCustomers',
    method: 'get',
    path: '/customers',
    tags: ['customers'],
    summary: 'Customer portfolio (scoped)',
    auth: 'session',
    request: { query: CustomersQuerySchema },
    responses: { 200: { description: 'Carteira de clientes', schema: CustomersResponseSchema } },
    errors: [400, 401, 403],
  }),
  getCustomer: defineRoute({
    operationId: 'getCustomer',
    method: 'get',
    path: '/customers/{code}',
    tags: ['customers'],
    summary: 'Customer detail (scoped)',
    description: 'A customer outside the actor scope is reported as 404.',
    auth: 'session',
    request: { params: CustomerPathSchema },
    responses: { 200: { description: 'Cliente', schema: CustomerDetailSchema } },
    errors: [400, 401, 403, 404],
  }),

  listProductGroups: defineRoute({
    operationId: 'listProductGroups',
    method: 'get',
    path: '/product-groups',
    tags: ['catalog'],
    summary: 'Product groups',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Grupos de produto', schema: ProductGroupsResponseSchema } },
    errors: [401, 403],
  }),
  listProducts: defineRoute({
    operationId: 'listProducts',
    method: 'get',
    path: '/products',
    tags: ['catalog'],
    summary: 'Product catalog with list price context',
    description:
      'With `customerCode` prices are resolved against that customer table (within scope); otherwise against the catalog reference table.',
    auth: 'session',
    request: { query: ProductsQuerySchema },
    responses: { 200: { description: 'Produtos', schema: ProductsResponseSchema } },
    errors: [400, 401, 403, 404],
  }),
  getProduct: defineRoute({
    operationId: 'getProduct',
    method: 'get',
    path: '/products/{code}',
    tags: ['catalog'],
    summary: 'Product detail with list price context',
    auth: 'session',
    request: { params: ProductPathSchema, query: ProductDetailQuerySchema },
    responses: { 200: { description: 'Produto', schema: ProductDetailSchema } },
    errors: [400, 401, 403, 404],
  }),
  resolveProducts: defineRoute({
    operationId: 'resolveProducts',
    method: 'post',
    path: '/product-resolutions',
    tags: ['catalog'],
    summary: 'Resolve a batch of product identifiers',
    description:
      'A read, not a write. Each identifier (trimmed) is matched exactly, with no wildcard or fuzzy matching: against the product code when it is all digits without leading zeros (\'007\' is not code 7), and against the product reference (case-sensitive). One answer per identifier, in request order; a duplicate identifier is answered at each position. found: exactly one visible product; ambiguous: several (up to 5 candidates, ordered by code); not_found: none. A product the configuration hides from the catalog counts as not found. With `customerCode` prices come from that customer table (404 outside the seller scope); otherwise from the catalog reference table. Body up to 128 kB.',
    auth: 'session',
    request: { body: ResolveProductsRequestSchema },
    maxBodyBytes: 128 * 1024,
    responses: { 200: { description: 'Uma resposta por identificador', schema: ResolveProductsResponseSchema } },
    errors: [400, 401, 403, 404],
  }),

  listOrders: defineRoute({
    operationId: 'listOrders',
    method: 'get',
    path: '/orders',
    tags: ['orders'],
    summary: 'Orders and drafts (scoped)',
    auth: 'session',
    request: { query: OrdersQuerySchema },
    responses: { 200: { description: 'Pedidos', schema: OrdersResponseSchema } },
    errors: [400, 401, 403],
  }),
  createOrder: defineRoute({
    operationId: 'createOrder',
    method: 'post',
    path: '/orders',
    tags: ['orders'],
    summary: 'Create a draft order',
    description:
      'Idempotent on `clientRequestId`: 201 when created, 200 with the original order on a replay of the same payload, 409 idempotency_conflict when the id was used with a different payload. Prices are always computed server-side. `expectedDataset` is required: 409 dataset_mismatch (nothing is written) when it differs from the dataset the server declares, or the server declares none.',
    auth: 'session',
    request: { body: CreateOrderRequestSchema },
    responses: {
      201: { description: 'Rascunho criado', schema: OrderDetailSchema },
      200: { description: 'Reenvio idempotente: pedido original', schema: OrderDetailSchema },
    },
    errors: [400, 401, 403, 404, 409],
  }),
  getOrder: defineRoute({
    operationId: 'getOrder',
    method: 'get',
    path: '/orders/{id}',
    tags: ['orders'],
    summary: 'Order detail (scoped)',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: { 200: { description: 'Pedido', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404],
  }),
  replaceOrder: defineRoute({
    operationId: 'replaceOrder',
    method: 'put',
    path: '/orders/{id}',
    tags: ['orders'],
    summary: 'Replace a draft (optimistic concurrency)',
    description:
      'Full replace. 409 version_conflict when `expectedVersion` is stale; 409 order_not_editable when the order is not a draft. The server recomputes prices and totals. `expectedDataset` is required: 409 dataset_mismatch (the order is not changed) when it differs from the dataset the server declares, or the server declares none.',
    auth: 'session',
    request: { params: OrderPathSchema, body: ReplaceOrderRequestSchema },
    responses: { 200: { description: 'Rascunho atualizado', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  discardOrder: defineRoute({
    operationId: 'discardOrder',
    method: 'delete',
    path: '/orders/{id}',
    tags: ['orders'],
    summary: 'Discard a draft (status becomes cancelled)',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: { 200: { description: 'Rascunho descartado', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  submitOrder: defineRoute({
    operationId: 'submitOrder',
    method: 'post',
    path: '/orders/{id}/submit',
    tags: ['orders'],
    summary: 'Submit an order to the ERP (disabled)',
    description:
      'Always 409 erp_submission_disabled until the ERP write-safety gates close (SNK-4/SNK-5).',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: {
      409: {
        description: 'Envio ao ERP aguardando conclusão da integração segura',
        schema: ErpSubmissionDisabledErrorSchema,
      },
    },
    errors: [400, 401, 403, 404],
  }),
  repeatLastOrder: defineRoute({
    operationId: 'repeatLastOrder',
    method: 'post',
    path: '/customers/{code}/orders/repeat-last',
    tags: ['orders'],
    summary: "Create a new draft from the customer's most recent order ('Repetir último pedido')",
    description:
      "Creates a NEW, independent draft from the customer's most recent NON-cancelled order recorded in Sales Force (never from Sankhya/ERP history, which is not mirrored here), through the same path as `createOrder`, using `clientRequestId` as the draft request id (201 created; 200 with the original draft on a replay of the same request). Only `productCode` and `quantity` are copied from the source order; no price, discount or note. Each line is revalidated against the current catalog and the customer price context; lines whose product is removed, inactive, hidden, not sellable or without a usable price are left out and reported in `skippedLines`, never priced by guess. The new draft is assigned to the customer's CURRENT seller, which may differ from the source order's seller. 409 conflict (details.reason `no_previous_order`) when the customer has no previous order in Sales Force at all. 409 conflict (details.reason `no_usable_lines`, with `skippedLines`) when no line of the source order can be used: no draft is created. The source order is never modified. `expectedDataset` is required: 409 dataset_mismatch (nothing is written) when it differs from the dataset the server declares, or the server declares none.",
    auth: 'session',
    request: { params: CustomerPathSchema, body: RepeatLastOrderRequestSchema },
    maxBodyBytes: 2 * 1024,
    responses: {
      201: { description: 'Rascunho criado a partir do último pedido', schema: RepeatLastOrderResponseSchema },
      200: { description: 'Reenvio idempotente: rascunho original', schema: RepeatLastOrderResponseSchema },
    },
    errors: [400, 401, 403, 404, 409],
  }),

  listOrderTemplates: defineRoute({
    operationId: 'listOrderTemplates',
    method: 'get',
    path: '/customers/{code}/order-templates',
    tags: ['order-templates'],
    summary: 'Recurring order templates of a customer (scoped)',
    description:
      'Live templates of the customer, by name. A customer outside the actor scope is reported as 404. At most 50 per customer.',
    auth: 'session',
    request: { params: CustomerPathSchema },
    responses: { 200: { description: 'Modelos do cliente', schema: OrderTemplatesResponseSchema } },
    errors: [400, 401, 403, 404],
  }),
  createOrderTemplate: defineRoute({
    operationId: 'createOrderTemplate',
    method: 'post',
    path: '/customers/{code}/order-templates',
    tags: ['order-templates'],
    summary: 'Save a recurring order template for a customer',
    description:
      'A saved list of product + quantity (1 to 500 lines, each product once); no price, discount or note. Idempotent on `clientRequestId` per account: 201 when created, 200 with the same template on a replay of the same payload, 409 idempotency_conflict when the id was used with a different payload. 409 conflict (details.reason `template_limit_reached`) beyond 50 live templates for the customer; 409 conflict (`template_name_taken`) when a live template of the customer already has that name, ignoring case. `expectedDataset` is required: 409 dataset_mismatch (nothing is written) when it differs from the dataset the server declares, or the server declares none. Body up to 128 kB.',
    auth: 'session',
    request: { params: CustomerPathSchema, body: CreateOrderTemplateRequestSchema },
    maxBodyBytes: 128 * 1024,
    responses: {
      201: { description: 'Modelo criado', schema: OrderTemplateDetailSchema },
      200: { description: 'Reenvio idempotente: modelo original', schema: OrderTemplateDetailSchema },
    },
    errors: [400, 401, 403, 404, 409],
  }),
  getOrderTemplate: defineRoute({
    operationId: 'getOrderTemplate',
    method: 'get',
    path: '/order-templates/{id}',
    tags: ['order-templates'],
    summary: 'Order template detail (scoped)',
    description: 'A template of a customer outside the actor scope, or a deleted one, is reported as 404.',
    auth: 'session',
    request: { params: OrderTemplatePathSchema },
    responses: { 200: { description: 'Modelo', schema: OrderTemplateDetailSchema } },
    errors: [400, 401, 403, 404],
  }),
  replaceOrderTemplate: defineRoute({
    operationId: 'replaceOrderTemplate',
    method: 'put',
    path: '/order-templates/{id}',
    tags: ['order-templates'],
    summary: 'Replace an order template (optimistic concurrency)',
    description:
      'Full replace of name and lines; the customer never changes. 409 version_conflict when `expectedVersion` is stale; 409 conflict (`template_name_taken`) on a name collision. `expectedDataset` is required: 409 dataset_mismatch (the template is not changed) when it differs from the dataset the server declares, or the server declares none. Body up to 128 kB.',
    auth: 'session',
    request: { params: OrderTemplatePathSchema, body: ReplaceOrderTemplateRequestSchema },
    maxBodyBytes: 128 * 1024,
    responses: { 200: { description: 'Modelo atualizado', schema: OrderTemplateDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  deleteOrderTemplate: defineRoute({
    operationId: 'deleteOrderTemplate',
    method: 'delete',
    path: '/order-templates/{id}',
    tags: ['order-templates'],
    summary: 'Delete an order template (soft delete)',
    description: 'Orders already created from the template are not affected.',
    auth: 'session',
    request: { params: OrderTemplatePathSchema },
    responses: { 204: { description: 'Modelo removido' } },
    errors: [400, 401, 403, 404],
  }),
  useOrderTemplate: defineRoute({
    operationId: 'useOrderTemplate',
    method: 'post',
    path: '/order-templates/{id}/use',
    tags: ['order-templates'],
    summary: 'Create a new draft order from a template',
    description:
      'Creates a NEW draft for the template customer through the same path as `createOrder`, using `clientRequestId` as the draft request id (201 created; 200 with the original draft on a replay of the same request). Each line is revalidated against the current catalog and the customer price context; lines whose product is removed, inactive, hidden, not sellable or without a usable price are left out and reported in `skippedLines`, never priced by guess. 409 conflict (details.reason `no_usable_lines`, with `skippedLines`) when no line can be used: no draft is created. The draft is independent of the template afterwards. `expectedDataset` is required: 409 dataset_mismatch (nothing is written) when it differs from the dataset the server declares, or the server declares none.',
    auth: 'session',
    request: { params: OrderTemplatePathSchema, body: UseOrderTemplateRequestSchema },
    maxBodyBytes: 2 * 1024,
    responses: {
      201: { description: 'Rascunho criado a partir do modelo', schema: UseOrderTemplateResponseSchema },
      200: { description: 'Reenvio idempotente: rascunho original', schema: UseOrderTemplateResponseSchema },
    },
    errors: [400, 401, 403, 404, 409],
  }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

export const routeList: readonly RouteDefinition[] = Object.values(routes);

/** Express/Nest-style path (`/customers/:code`) for binding a controller to a route. */
export function toColonPath(route: Pick<RouteDefinition, 'path'>): string {
  return route.path.replace(/\{([^}]+)\}/g, ':$1');
}

/* ---------- type helpers for server handlers and clients ---------- */

type OutputOf<S> = S extends z.ZodType ? z.output<S> : never;
export type RouteParams<R extends RouteDefinition> = OutputOf<R['request']['params']>;
export type RouteQuery<R extends RouteDefinition> = OutputOf<R['request']['query']>;
export type RouteBody<R extends RouteDefinition> = OutputOf<R['request']['body']>;
/** Body of the response with the given HTTP status. */
export type RouteResponseBody<
  R extends RouteDefinition,
  S extends keyof R['responses'],
> = R['responses'][S] extends { schema: infer Z } ? OutputOf<Z> : never;
