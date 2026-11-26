import type { z } from 'zod';
import {
  LoginRequestSchema,
  LoginResponseSchema,
  PHOTO_UPLOAD_MAX_BODY_BYTES,
  ProfilePhotoSchema,
  PutProfilePhotoRequestSchema,
  SessionResponseSchema,
} from './auth.js';
import {
  CitiesResponseSchema,
  NeighborhoodsResponseSchema,
  PostalCodeLookupSchema,
  PostalCodePathSchema,
  StreetsResponseSchema,
} from './address.js';
import {
  ProductDetailQuerySchema,
  ProductDetailSchema,
  ProductGroupsResponseSchema,
  CarriersResponseSchema,
  ProductImageQuerySchema,
  PriceTablePathSchema,
  PriceTablePricesQuerySchema,
  PriceTablePricesResponseSchema,
  ProductPathSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
  ResolveProductsRequestSchema,
  ResolveProductsResponseSchema,
} from './catalog.js';
import { ConfigurationResponseSchema, OrderEntryConfigurationSchema } from './configuration.js';
import {
  CreateCustomerRequestSchema,
  CreateCustomerResponseSchema,
  CustomerRegistrationPathSchema,
  CustomerRegistrationsQuerySchema,
  CustomerRegistrationsResponseSchema,
  CustomerRegistrationViewSchema,
  SetCustomerRegistrationSellerRequestSchema,
  UpdateCustomerRequestSchema,
  UpdateCustomerResponseSchema,
} from './customer-write.js';
import {
  CustomerDetailSchema,
  CustomerFinancialSchema,
  CustomerPathSchema,
  CustomerLettersQuerySchema,
  CustomerLettersResponseSchema,
  CustomersQuerySchema,
  CustomersResponseSchema,
} from './customers.js';
import {
  ApprovalPathSchema,
  ApprovalQueueQuerySchema,
  ApprovalQueueResponseSchema,
  ApproveApprovalRequestSchema,
  RejectApprovalRequestSchema,
} from './approvals.js';
import { ReleaseQueueCountQuerySchema, ReleaseQueueCountResponseSchema, ReleaseQueueQuerySchema, ReleaseQueueResponseSchema } from './release-queue.js';
import { DashboardResponseSchema } from './dashboard.js';
import { OrderRefreshAcceptedSchema, StartSyncRefreshResponseSchema, SyncRefreshPathSchema, SyncRefreshViewSchema, SyncStatusResponseSchema } from './sync-refresh.js';
import { DiscountLimitsResponseSchema, UpdateDiscountLimitsRequestSchema } from './discount-limits.js';
import { ErpSubmissionDisabledErrorSchema, type ErrorStatus } from './errors.js';
import { HealthResponseSchema, ReadyResponseSchema } from './health.js';
import {
  CreateOrderRequestSchema,
  OrderDetailSchema,
  OrderPathSchema,
  OrdersQuerySchema,
  OrdersResponseSchema,
  ReplaceOrderRequestSchema,
  DuplicateAsOrderRequestSchema,
  RepeatLastOrderRequestSchema,
  CustomerOrderHabitsSchema,
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

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type RouteAuth = 'public' | 'session';

export interface RouteResponse {
  readonly description: string;
  /** Omitted for responses without a body (e.g. 204). */
  readonly schema?: z.ZodType;
  /** A binary body (e.g. an image) instead of JSON: the allowed `Content-Type`s. Mutually exclusive with `schema`. */
  readonly binary?: { readonly contentTypes: readonly string[] };
  /** Documented response headers: name -> description. */
  readonly headers?: Readonly<Record<string, string>>;
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
    errors: [400, 401, 403, 429, 503],
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
  putProfilePhoto: defineRoute({
    operationId: 'putProfilePhoto',
    method: 'put',
    path: '/me/photo',
    tags: ['auth'],
    summary: "Set or replace the caller's own profile photo",
    description:
      'Own photo only (there is no way to name another account). Body: the image base64-encoded (jpeg, png or webp, up to 5 MiB decoded) with its declared content type and an optional crop rectangle in pixels (after EXIF orientation). The server checks the magic bytes against the declared type, refuses animated or oversized (> 32 megapixels) images, crops to a centre square, downsizes to at most 512 px and re-encodes as WebP without any metadata (EXIF, location). 400 validation_failed (details.issues: photo_type_not_allowed, photo_content_mismatch, photo_too_large, photo_unreadable, photo_crop_invalid, photo_too_small); 429 rate_limited when changed again within 5 seconds; 503 service_unavailable when photo storage is not configured or unreachable. 200 returns the new version. Not mirrored to the ERP.',
    auth: 'session',
    request: { body: PutProfilePhotoRequestSchema },
    maxBodyBytes: PHOTO_UPLOAD_MAX_BODY_BYTES,
    responses: { 200: { description: 'Foto salva', schema: ProfilePhotoSchema } },
    errors: [400, 401, 403, 429, 503],
  }),
  deleteProfilePhoto: defineRoute({
    operationId: 'deleteProfilePhoto',
    method: 'delete',
    path: '/me/photo',
    tags: ['auth'],
    summary: "Remove the caller's own profile photo",
    description: 'Idempotent: 204 whether or not a photo existed. Audited when one was removed.',
    auth: 'session',
    request: {},
    responses: { 204: { description: 'Foto removida' } },
    errors: [401, 403, 503],
  }),
  getProfilePhoto: defineRoute({
    operationId: 'getProfilePhoto',
    method: 'get',
    path: '/me/photo',
    tags: ['auth'],
    summary: "The caller's own profile photo (binary)",
    description:
      'Authenticated only, own photo only. 404 when there is none. Always a square WebP of at most 512 px. The ETag is the photo version (the same value as photoVersion in the session); send it in If-None-Match to get 304. Cache-Control is private; nosniff.',
    auth: 'session',
    request: {},
    responses: {
      200: {
        description: 'Imagem',
        binary: { contentTypes: ['image/webp'] },
        headers: { ETag: 'Photo version', 'Cache-Control': 'private, max-age (revalidate with If-None-Match)', 'Content-Disposition': 'inline' },
      },
      304: { description: 'Imagem inalterada (If-None-Match)' },
    },
    errors: [401, 403, 404, 503],
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

  getDiscountLimits: defineRoute({
    operationId: 'getDiscountLimits',
    method: 'get',
    path: '/discount-limits',
    tags: ['configuration'],
    summary: 'Discount limits per authority level (W-39, admin only)',
    description:
      'The three inclusive limits (seller, manager, director = absolute ceiling) in force, flagged provisional until the admin confirms them.',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Limites de desconto vigentes', schema: DiscountLimitsResponseSchema } },
    errors: [401, 403, 409],
  }),
  updateDiscountLimits: defineRoute({
    operationId: 'updateDiscountLimits',
    method: 'put',
    path: '/discount-limits',
    tags: ['configuration'],
    summary: 'Replace the discount limits (W-39, admin only, audited)',
    description:
      'Stores a new immutable configuration snapshot. Ascending (seller <= manager <= director), inclusive, 0 to 99.99. Optimistic on expectedRevision.',
    auth: 'session',
    request: { body: UpdateDiscountLimitsRequestSchema },
    responses: { 200: { description: 'Limites atualizados', schema: DiscountLimitsResponseSchema } },
    errors: [400, 401, 403, 409],
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

  startSyncRefresh: defineRoute({
    operationId: 'startSyncRefresh',
    method: 'post',
    path: '/sync/refresh',
    tags: ['sync'],
    summary: 'Ask the worker to re-read the Sankhya data now (D-AB B3)',
    description:
      'The API never reads Sankhya: it records the request and the worker runs the read-only steps. Singleton: a refresh already running is returned (reused=true); so is one that finished less than 60 s ago (per-installation cooldown).',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Atualização iniciada ou reaproveitada', schema: StartSyncRefreshResponseSchema } },
    errors: [401, 403],
  }),

  getSyncRefresh: defineRoute({
    operationId: 'getSyncRefresh',
    method: 'get',
    path: '/sync/refresh/{id}',
    tags: ['sync'],
    summary: 'Progress of an on-demand refresh, one step per entity',
    auth: 'session',
    request: { params: SyncRefreshPathSchema },
    responses: { 200: { description: 'Estado da atualização', schema: SyncRefreshViewSchema } },
    errors: [400, 401, 403, 404],
  }),

  getSyncStatus: defineRoute({
    operationId: 'getSyncStatus',
    method: 'get',
    path: '/sync/status',
    tags: ['sync'],
    summary: 'Age of the Sankhya data shown in the screens',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Horário dos dados', schema: SyncStatusResponseSchema } },
    errors: [401, 403],
  }),

  getSyncEvents: defineRoute({
    operationId: 'getSyncEvents',
    method: 'get',
    path: '/sync/events',
    tags: ['sync'],
    summary: 'Server-sent events: content-free change pings (RT-1)',
    description:
      'text/event-stream. Frames are "event: ping" with data {"topic":"orders"} or {"topic":"reference"}; a comment heartbeat every 25 s. No business data: the client re-reads through the normal authorized endpoints. At most 5 streams per account (429 beyond that). The stream ends when the session is revoked or expires.',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Fluxo de eventos', binary: { contentTypes: ['text/event-stream'] }, headers: { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } } },
    errors: [401, 403, 429, 503],
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
  listCustomerLetters: defineRoute({
    operationId: 'listCustomerLetters',
    method: 'get',
    path: '/customers/letters',
    tags: ['customers'],
    summary: 'Count of visible customers per initial letter (A-Z index)',
    auth: 'session',
    request: { query: CustomerLettersQuerySchema },
    responses: { 200: { description: 'Contagem por letra inicial', schema: CustomerLettersResponseSchema } },
    errors: [400, 401, 403],
  }),
  createCustomer: defineRoute({
    operationId: 'createCustomer',
    method: 'post',
    path: '/customers',
    tags: ['customers'],
    summary: 'Create a customer in the Force (written to the ERP by the worker)',
    description:
      'Records the creation and waits up to ~8 s (configurable) for the worker to deliver it to the ERP (CUST-RT). 201 with `sendState` `sent` and the real `customerCode`; 202 with `sendState` `pending` when the ERP did not answer in time (delivery continues in the worker; the client shows a pending-send indicator and follows GET /customers/registrations/{id}); 200 with the recorded state on a replay of the same `clientRequestId` and payload. 422 `customer_refused` with `details.fields` (field -> pt-BR text: `sellerCode`, `document`, `stateRegistration`, ...) when validation or the ERP refuses (missing seller, repeated CPF/CNPJ, required field): nothing is left half saved and no correction queue exists; fix the data and POST again with a NEW `clientRequestId`. Seller: automatic for a seller (own ERP code); required for manager/admin (422 on `sellerCode` without any ERP call). 409 idempotency_conflict when the id was used with a different payload; 409 `customer_write_disabled` while the installation has not enabled customer writes. The credit limit is never sent. 400 validation_failed (details.issues) for a malformed body. 429 rate_limited beyond the hourly creation limit. `correctsRegistrationId` is still accepted by old builds and ignored.',
    auth: 'session',
    request: { body: CreateCustomerRequestSchema },
    maxBodyBytes: 8 * 1024,
    responses: {
      201: { description: 'Cliente criado e confirmado no Sankhya', schema: CreateCustomerResponseSchema },
      200: { description: 'Reenvio idempotente: estado registrado', schema: CreateCustomerResponseSchema },
      202: { description: 'Aguardando envio ao Sankhya', schema: CreateCustomerResponseSchema },
    },
    errors: [400, 401, 403, 409, 422, 429],
  }),
  listCustomerRegistrations: defineRoute({
    operationId: 'listCustomerRegistrations',
    method: 'get',
    path: '/customers/registrations',
    tags: ['customers'],
    summary: 'Customers created in the Force that are not yet in the ERP mirror, or were refused (scoped)',
    description:
      'Each item carries `sendState` (`sent` with `customerCode`, or `pending`) and the legacy `state`/`stateLabel`. A refused customer is not listed (the refusal is answered by POST /customers as 422). Scope: the creator; a manager/admin sees those of the sellers they reach.',
    auth: 'session',
    request: { query: CustomerRegistrationsQuerySchema },
    responses: { 200: { description: 'Cadastros de clientes feitos pelo Force', schema: CustomerRegistrationsResponseSchema } },
    errors: [400, 401, 403],
  }),
  getCustomerRegistration: defineRoute({
    operationId: 'getCustomerRegistration',
    method: 'get',
    path: '/customers/registrations/{registrationId}',
    tags: ['customers'],
    summary: 'One customer registration with its state (scoped)',
    description: 'A registration outside the actor scope answers 404, like a missing one. Use it to follow an `awaiting_send` customer after the 202 of POST /customers.',
    auth: 'session',
    request: { params: CustomerRegistrationPathSchema },
    responses: { 200: { description: 'Cadastro', schema: CustomerRegistrationViewSchema } },
    errors: [400, 401, 403, 404],
  }),
  setCustomerRegistrationSeller: defineRoute({
    operationId: 'setCustomerRegistrationSeller',
    method: 'put',
    path: '/customers/registrations/{registrationId}/seller',
    tags: ['customers'],
    summary: 'Set the seller of a pending customer that has none and send it again (manager/admin)',
    description:
      'Manager/admin only (a seller answers 403; outside the actor scope 404). Only a customer not yet delivered (no ERP code). The seller must be an active seller of the ERP mirror (422 customer_refused on sellerCode otherwise). Re-enqueues delivery through the outbox; the API never calls the ERP. Answers the registration view.',
    auth: 'session',
    request: { params: CustomerRegistrationPathSchema, body: SetCustomerRegistrationSellerRequestSchema },
    maxBodyBytes: 1024,
    responses: { 200: { description: 'Cadastro reenviado', schema: CustomerRegistrationViewSchema } },
    errors: [400, 401, 403, 404, 409, 422],
  }),
  updateCustomer: defineRoute({
    operationId: 'updateCustomer',
    method: 'patch',
    path: '/customers/{code}',
    tags: ['customers'],
    summary: 'Edit phone, e-mail and notes of a customer (D-AP); written to the ERP by the worker',
    description:
      'Same rule for the site and the app. Allow-list: any other key is refused with 400 validation_failed whose `details.issues[].path` names the field (unrecognized_keys). Seller: only customers of their own portfolio; manager/admin: the portfolio they reach; outside it 404. 409 conflict with `details.reason` `customer_edit_disabled` while `ERP_CUSTOMER_EDIT_ENABLED` is closed (default; nothing is stored and the ERP is never called). With the flag open the change is recorded as a command in the outbox and the API waits up to ~8 s (configurable) for the worker to deliver it (CUST-RT): 200 with `sendState` `sent`; 202 with `sendState` `pending` when the ERP did not answer in time (delivery continues; replay the same `clientRequestId` and payload to follow it: 200); 422 `customer_refused` with `details.fields` (field -> pt-BR text) when the ERP refuses (nothing changes locally; send a new `clientRequestId`). 409 `idempotency_conflict` for the same id with another payload; 409 `customer_update_in_progress` while another edit of the same customer is not yet delivered. `contacts` and `addresses` are accepted by the schema but refused with 409 `details.reason` `customer_edit_field_not_supported` (the ERP mapping is not validated, S5.2); phone, e-mail and notes are the deliverable fields. Never changes name, document, seller, price table, status or limits.',
    auth: 'session',
    request: { params: CustomerPathSchema, body: UpdateCustomerRequestSchema },
    maxBodyBytes: 16 * 1024,
    responses: {
      202: { description: 'Alteração registrada, aguardando envio ao Sankhya', schema: UpdateCustomerResponseSchema },
      200: { description: 'Reenvio idempotente: estado registrado', schema: UpdateCustomerResponseSchema },
    },
    errors: [400, 401, 403, 404, 409, 422],
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
  getCustomerFinancial: defineRoute({
    operationId: 'getCustomerFinancial',
    method: 'get',
    path: '/customers/{code}/financial',
    tags: ['customers'],
    summary: 'Customer financial information (read-only, scoped)',
    description:
      'Open titles and credit information mirrored from the ERP (D-I). A customer outside the actor scope, or an installation that does not show the financial area, is reported as 404.',
    auth: 'session',
    request: { params: CustomerPathSchema },
    responses: { 200: { description: 'Financeiro do cliente', schema: CustomerFinancialSchema } },
    errors: [400, 401, 403, 404],
  }),

  getCustomerOrderHabits: defineRoute({
    operationId: 'getCustomerOrderHabits',
    method: 'get',
    path: '/customers/{code}/order-habits',
    tags: ['orders'],
    summary: "Negotiation type most used in the customer's Sales Force orders (read-only, scoped)",
    description:
      'Counts only orders recorded in Sales Force (sent for approval or delivery; drafts and rejected ones excluded), never Sankhya/ERP history. A customer outside the actor scope answers 404, like a missing one.',
    auth: 'session',
    request: { params: CustomerPathSchema },
    responses: { 200: { description: 'Hábitos de pedido do cliente', schema: CustomerOrderHabitsSchema } },
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
  listCarriers: defineRoute({
    operationId: 'listCarriers',
    method: 'get',
    path: '/carriers',
    tags: ['catalog'],
    summary: 'Active carriers (transportadoras) mirrored from Sankhya, ordered by name',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Transportadoras ativas', schema: CarriersResponseSchema } },
    errors: [401, 403],
  }),
  listCities: defineRoute({
    operationId: 'listCities',
    method: 'get',
    path: '/cities',
    tags: ['catalog'],
    summary: 'ERP cities (code, name, UF, IBGE) for the customer registration, ordered by UF and name',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Cidades do cadastro do ERP', schema: CitiesResponseSchema } },
    errors: [401, 403],
  }),
  listNeighborhoods: defineRoute({
    operationId: 'listNeighborhoods',
    method: 'get',
    path: '/neighborhoods',
    tags: ['catalog'],
    summary: 'ERP neighborhoods (code, name) for the customer registration, ordered by name',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Bairros do cadastro do ERP', schema: NeighborhoodsResponseSchema } },
    errors: [401, 403],
  }),
  listStreets: defineRoute({
    operationId: 'listStreets',
    method: 'get',
    path: '/streets',
    tags: ['catalog'],
    summary: 'ERP streets (code, name, kind) for the customer registration, ordered by name',
    auth: 'session',
    request: {},
    responses: { 200: { description: 'Logradouros do cadastro do ERP', schema: StreetsResponseSchema } },
    errors: [401, 403],
  }),
  lookupPostalCode: defineRoute({
    operationId: 'lookupPostalCode',
    method: 'get',
    path: '/customers/postal-code/{cep}',
    tags: ['customers'],
    summary: 'Address of a postal code (CEP), matched against the ERP registry',
    description:
      'Looks the CEP up in ViaCEP and, when it does not answer, BrasilAPI (about 2 s each; only the 8 digits leave the server). Never an error for a CEP that is invalid, unknown or whose sources are down: answers 200 with `found: false`. When found, `cityCode` is set when the ERP city matches (IBGE + UF, else name without accents + UF) and `neighborhoodCode` / `streetCode` when the text matches an ERP row; otherwise only the text is returned. Same authorization as customer registration.',
    auth: 'session',
    request: { params: PostalCodePathSchema },
    responses: { 200: { description: 'Endereço do CEP (ou found=false)', schema: PostalCodeLookupSchema } },
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
  getPriceTablePrices: defineRoute({
    operationId: 'getPriceTablePrices',
    method: 'get',
    path: '/price-tables/{code}/prices',
    tags: ['catalog'],
    summary: 'Current list prices of ONE price table (for the device, one table at a time)',
    description:
      'Only tables used by customers within the caller\'s scope (the customer\'s mobile-eligible table, or the configured fallback table when a visible customer has none); any other table, or a missing one, is the same 404 (no oracle). Only products that are mobility-visible, sellable and priced above zero in the effective version; the list price only (no cost, no margin), ordered by product code. The device keeps these per table and applies the table of the customer it is ordering for.',
    auth: 'session',
    request: { params: PriceTablePathSchema, query: PriceTablePricesQuerySchema },
    responses: { 200: { description: 'Preços vigentes da tabela', schema: PriceTablePricesResponseSchema } },
    errors: [400, 401, 403, 404],
  }),
  getProductImage: defineRoute({
    operationId: 'getProductImage',
    method: 'get',
    path: '/products/{code}/image',
    tags: ['catalog'],
    summary: 'Product image (binary)',
    description:
      'Same access as the catalog: a product the caller cannot see is 404, a seller without a seller link is 403 no_seller_scope. 404 also when the product has no image. The server serves only png, jpeg or webp content it has verified (never svg/html), with `nosniff`, `Content-Disposition: inline` and `Cache-Control: private`. `ETag` is derived from the opaque image version; send it back in `If-None-Match` to get 304. 503 when the image source is unavailable (retry later). The client never supplies a URL or path.',
    auth: 'session',
    request: { params: ProductPathSchema, query: ProductImageQuerySchema },
    responses: {
      200: {
        description: 'Imagem',
        binary: { contentTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        headers: {
          ETag: 'Entity tag derived from the opaque image version',
          'Cache-Control': 'private, max-age (revalidate with If-None-Match)',
          'Content-Disposition': 'inline',
        },
      },
      304: { description: 'Imagem inalterada (If-None-Match)' },
    },
    errors: [400, 401, 403, 404, 503],
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
      201: { description: 'Pedido criado (não enviado)', schema: OrderDetailSchema },
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
    responses: { 200: { description: 'Pedido atualizado (não enviado)', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  deleteOrder: defineRoute({
    operationId: 'deleteOrder',
    method: 'delete',
    path: '/orders/{id}',
    tags: ['orders'],
    summary: 'Delete a quote or order that never reached Sankhya (D-Y)',
    description:
      'Physical deletion with its items and delivery records. 409 when the order has an ERP number or a delivery is queued or in progress. Recorded in the audit trail.',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: { 204: { description: 'Orçamento ou pedido excluído' } },
    errors: [400, 401, 403, 404, 409],
  }),
  convertQuote: defineRoute({
    operationId: 'convertQuote',
    method: 'post',
    path: '/orders/{id}/convert',
    tags: ['orders'],
    summary: 'Convert a quote that never reached Sankhya into an order, in place (D-U a)',
    description:
      'The TOP becomes the installation order TOP on the same record (same id, number and lines); the version is bumped and a pending approval is invalidated. 409 not_a_quotation when the document is not a quote, already_in_sankhya when it has a Sankhya number (native conversion is a separate step), order_top_not_configured without an order TOP.',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: { 200: { description: 'Orçamento convertido em pedido', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  submitOrder: defineRoute({
    operationId: 'submitOrder',
    method: 'post',
    path: '/orders/{id}/submit',
    tags: ['orders'],
    summary: 'Submit an order: sends it for discount approval, or (disabled) to the ERP',
    description:
      'The server recomputes the discount authority from the stored lines with the role of the draft OWNER (DISC-5, Q12). Above that authority: 200 with the order in awaiting_approval (idempotent for an order already waiting). Above the director ceiling: 409 discount_blocked. Within authority: 409 erp_submission_disabled until the ERP write-safety gates close (SNK-4/SNK-5).',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: {
      200: { description: 'Pedido enviado para aprovação de desconto', schema: OrderDetailSchema },
      409: {
        description: 'Envio ao ERP aguardando conclusão da integração segura',
        schema: ErpSubmissionDisabledErrorSchema,
      },
    },
    errors: [400, 401, 403, 404],
  }),
  verifyOrderDelivery: defineRoute({
    operationId: 'verifyOrderDelivery',
    method: 'post',
    path: '/orders/{id}/verify-delivery',
    tags: ['orders'],
    summary: 'Verify now: asks the worker to check an ambiguous (unknown) delivery by origin right away',
    description:
      'Same delivery record and origin id, no second outbox row and no second note (SNK-4). Only for an order whose delivery is `unknown`; any other state returns the order unchanged. At most one request per order every 60 s (429). The actor is audited.',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: {
      200: { description: 'Pedido com a verificação solicitada', schema: OrderDetailSchema },
    },
    errors: [400, 401, 403, 404, 429],
  }),
  refreshOrder: defineRoute({
    operationId: 'refreshOrder',
    method: 'post',
    path: '/orders/{id}/refresh',
    tags: ['orders'],
    summary: 'Asks the worker to re-read this order in Sankhya now (RT-1)',
    description:
      'Records the request only (the API never calls Sankhya); the worker serves it within seconds and the clients learn the result from the next orders ping. 202 even inside the 10 s per-order cooldown (accepted=false). 404 when the order is outside the caller scope, removed or unknown.',
    auth: 'session',
    request: { params: OrderPathSchema },
    responses: { 202: { description: 'Pedido de atualização registrado', schema: OrderRefreshAcceptedSchema } },
    errors: [400, 401, 403, 404],
  }),
  listApprovals: defineRoute({
    operationId: 'listApprovals',
    method: 'get',
    path: '/approvals',
    tags: ['orders'],
    summary: 'Discount approval queue (W-20): the pending requests the caller may decide',
    description:
      'Manager role: requests of the manager level. Admin: requests of the director level ("Diretoria"). Oldest first. Online only; no push.',
    auth: 'session',
    request: { query: ApprovalQueueQuerySchema },
    responses: { 200: { description: 'Solicitações pendentes', schema: ApprovalQueueResponseSchema } },
    errors: [400, 401, 403],
  }),
  approveApproval: defineRoute({
    operationId: 'approveApproval',
    method: 'post',
    path: '/approvals/{id}/approve',
    tags: ['orders'],
    summary: 'Approve a pending discount request (explicit, audited)',
    description:
      'Only the pool of the request level decides. The comment is optional. 409 approval_not_pending when the request was already decided, invalidated by an edit, or the order is no longer waiting; 409 discount_blocked when the stored lines no longer fit any level under the current limits.',
    auth: 'session',
    request: { params: ApprovalPathSchema, body: ApproveApprovalRequestSchema },
    responses: { 200: { description: 'Pedido aprovado', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  rejectApproval: defineRoute({
    operationId: 'rejectApproval',
    method: 'post',
    path: '/approvals/{id}/reject',
    tags: ['orders'],
    summary: 'Reject a pending discount request (explicit, audited, comment mandatory)',
    description: 'The order becomes approval_rejected: editable by the seller, never sent as it stands.',
    auth: 'session',
    request: { params: ApprovalPathSchema, body: RejectApprovalRequestSchema },
    responses: { 200: { description: 'Pedido reprovado', schema: OrderDetailSchema } },
    errors: [400, 401, 403, 404, 409],
  }),
  listReleaseQueue: defineRoute({
    operationId: 'listReleaseQueue',
    method: 'get',
    path: '/release-queue',
    tags: ['orders'],
    summary: 'Release queue ("Aguardando liberação"): orders waiting for a Sankhya release, by sector (read only)',
    description:
      'Orders sent to Sankhya that hold a pending release line (TSILIB) of Pedidos or Financeiro, oldest waiting first, one row per line and sector. The release is done in Sankhya; the Force never writes it. Admin and manager see every sector; a user listed in `erp.releaseQueue.sectorUsers` sees only the listed sector(s); everyone else (sellers included) is refused with 403. A `sector` filter the caller may not see is 403. Data is the worker\'s mirror of the Sankhya read (`checkedAt` per row); "Atualizar agora" is POST /sync/refresh. No cost or margin.',
    auth: 'session',
    request: { query: ReleaseQueueQuerySchema },
    responses: { 200: { description: 'Pedidos aguardando liberação', schema: ReleaseQueueResponseSchema } },
    errors: [400, 401, 403],
  }),
  getReleaseQueueCount: defineRoute({
    operationId: 'getReleaseQueueCount',
    method: 'get',
    path: '/release-queue/count',
    tags: ['orders'],
    summary: 'Counter of the release queue for the menu (orders waiting, per sector the caller may see)',
    description: 'Same visibility as listReleaseQueue (403 when the caller sees no sector). Counts orders, not lines: an order waiting in both sectors counts once in `total`.',
    auth: 'session',
    request: { query: ReleaseQueueCountQuerySchema },
    responses: { 200: { description: 'Contagem por setor', schema: ReleaseQueueCountResponseSchema } },
    errors: [400, 401, 403],
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
      201: { description: 'Pedido não enviado criado a partir do último pedido', schema: RepeatLastOrderResponseSchema },
      200: { description: 'Reenvio idempotente: pedido original', schema: RepeatLastOrderResponseSchema },
    },
    errors: [400, 401, 403, 404, 409],
  }),

  duplicateAsOrder: defineRoute({
    operationId: 'duplicateAsOrder',
    method: 'post',
    path: '/orders/{id}/duplicate-as-order',
    tags: ['orders'],
    summary: "Create a new draft order from a quotation ('Duplicar como pedido')",
    description:
      "Creates a NEW, independent draft carrying the installation's default order TOP from an order that carries the quotation TOP and is visible to the caller, through the same path as `createOrder` (201 created; 200 with the original draft on a replay of the same `clientRequestId`). Lines (product, quantity, discount), negotiation type, notes and carrier are copied and each line is revalidated against the current catalog and prices; lines that cannot be ordered now are left out and reported in `skippedLines`, never priced by guess. The source quotation is never modified and no new state exists: the result is an ordinary draft whose `sourceOrderId` points to the quotation. 404 when the source is not visible. 409 conflict (details.reason `not_a_quotation`) when the source does not carry the quotation TOP; `order_top_not_configured` when the installation has no default order TOP; `no_usable_lines` (with `skippedLines`) when no line can be used. `expectedDataset` is required: 409 dataset_mismatch (nothing is written) when it differs from the dataset the server declares.",
    auth: 'session',
    request: { params: OrderPathSchema, body: DuplicateAsOrderRequestSchema },
    maxBodyBytes: 2 * 1024,
    responses: {
      201: { description: 'Pedido não enviado criado a partir do orçamento', schema: RepeatLastOrderResponseSchema },
      200: { description: 'Reenvio idempotente: pedido original', schema: RepeatLastOrderResponseSchema },
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
      201: { description: 'Pedido não enviado criado a partir do modelo', schema: UseOrderTemplateResponseSchema },
      200: { description: 'Reenvio idempotente: pedido original', schema: UseOrderTemplateResponseSchema },
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
