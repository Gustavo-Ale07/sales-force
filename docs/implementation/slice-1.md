# Slice 1 — implementation brief (working note)

> Working note, **not a decision register**. Authority: owner instruction "IMPLEMENTATION EXECUTION — SALES FORCE V1" (2026-09-18), `CLAUDE.md`, APPROVED entries of `docs/decisions.md`, evidence in `docs/sankhya-spike.md`. Anything not settled here or there stops and goes to the owner. Names below are working names; package versions are chosen by the implementer and verified by a real install/typecheck/test run.

## 1. Goal

A runnable Sales Force: login → dashboard → customer portfolio → customer detail → product catalog → new order (draft builder) → orders/drafts, plus an integration/configuration status page. Web only. No ERP order submission. Reusable product: PLAC is only the first installation (PROD-1).

## 2. Layout (pnpm + Turborepo, scope `@salesforce/*`)

```
apps/server     NestJS: API entry + Worker entry (STACK-2/3). Modules: platform, iam, customers, catalog, orders, dashboard, integration, sankhya-mirror
apps/web        Vite + React SPA, TanStack Router/Query, Tailwind, shadcn-style components (STACK-5)
packages/domain pure TS, no Node built-ins, no framework: entities, InstallationConfiguration type, pricing/ordering rules, money
packages/contracts Zod schemas = source of truth for API (STACK-4); OpenAPI generated from them; typed web client generated from OpenAPI (V-02 decided here)
packages/db     Drizzle schema (per-module files) + reviewed SQL migrations + one-shot migration runner with advisory lock (DATA-2)
packages/sankhya SankhyaGateway interface (Sales Force-shaped types), FakeGateway + synthetic fixtures, real read client (disabled unless configured)
packages/ui     design system (shadcn/Radix pattern), used by apps/web
packages/config tsconfig presets (exists)
deploy/         docker-compose.yml, .env.example, nginx/, scripts/ — no customer name in images/service names
```
Dependency rules: `docs/architecture.md` §4.1/§4.2 (`domain` imports nothing internal; `contracts` may use `domain` types; `db` and `sankhya` may use `domain` types; `web` never imports `db`/`sankhya`; only `apps/server` imports `db`/`sankhya`). Enforce with a dependency check script (test) so violations fail CI.

## 3. Installation configuration (CFG-1…6) — structured, typed, versioned

`InstallationConfiguration` (type in `domain`, Zod in `contracts`, stored as a versioned jsonb snapshot with content hash in PostgreSQL — not key/value strings). Nothing below has a default that equals a PLAC value; the "unconfigured" state is conservative (`general.enabled=false`, no orderable products without configuration).

```
schemaVersion: 1
source: { kind: 'sankhya' | 'bootstrap-file' | 'demo', version: string, syncedAt: ISO }   // U-11: source before the Sankhya model exists
general:  { enabled, enabledCompanyCodes: number[] }
sales:    { orderTopCode|null, quotationTopCode|null, defaultNegotiationTypeCode|null,
            negotiationTypes: {code,label}[], orderBehavior: { allowDraftWithoutPrice: bool, ... },
            confirmationBehavior: 'manual'|'automatic'|'disabled' }
customers:{ portfolioOwnership: { strategy: 'customer_seller_field' | 'explicit_account_links' | 'all_visible' },
            accountSellerLinks: { accountEmail, sellerCode }[],          // CFG-2, PROPOSED shape (U-10)
            customerWithoutPriceTable: 'no_resolved_table' | 'use_fallback_table',
            creditFeatures: { showCreditLimit: bool } }
products: { sellableUsageValues: string[], showInactive: bool,
            productWithoutPrice: { visible: bool, orderable: bool } }
pricing:  { customerTableStrategy: 'customer_table', fallbackStrategy: 'none'|'fixed_table', fallbackTableCode|null,
            catalogReferenceTableCode|null, missingPrice: 'no_price_state' }
financial:{ showFinancialArea: bool, overdueTitles: bool, creditChecks: bool }
features: { [flag: string]: boolean }        // typed known keys + open record
```
Sync/reconciliation state is NOT part of the snapshot; it lives in `sync_state`.
Demo configuration (fixture only) uses synthetic values deliberately different from PLAC's Sandbox values so any hardcoded PLAC constant shows up as a bug. Forbidden as literals anywhere outside fixtures/config data: `CODEMP=1`, TOP `1001`/`1101`, `CODTAB=5`, `CODTIPVENDA=1`, `USOPROD IN ('V','R')`, `AD_VDYORIG`, `AD_NUVIDYA`. A test must scan source for these.

## 4. Data flow (single path for real and demo data)

`SankhyaGateway` (fake today) → worker sync job → PostgreSQL mirror tables (hash-diff upserts) → API read services → contracts → web. `pnpm db:seed` = run the mirror sync once with the fake gateway (synthetic fixtures) + create dev accounts. There are **no mock arrays in UI or services**; only the gateway's data source is fake. Dashboard metrics that depend on unresolved rules (credit, positivation, commission) come from an isolated `DemoMetricsProvider` behind a `DashboardMetricsProvider` interface and are labelled "Dados de demonstração" in the UI.

Gateway (Sales Force-shaped; no TGF* names outside `packages/sankhya`): `readConfiguration()`, `readSellers()`, `readCustomers()`, `readProducts()`, `readPriceTables()`, `readListPrices()` — full-snapshot async iterables/pages, each with a stable order by full primary key. Per S1 (F-23, F-30): never use the incomplete unfiltered REST/`loadRecords` list path as authoritative; the real client uses the validated SQL ordered-by-full-key paging (`DbExplorerSP.executeQuery`) — its acceptance as production mechanism is still pending owner/architect (§9.33), so the real client is off by default (`SANKHYA_MODE=fake|live`), never wired to the exposed spike credentials (SEC-1), never touches Sankhya production (SNK-3), and has no write method.

## 5. PostgreSQL (versioned migrations; expand → migrate → contract)

Tables (snake_case; UUIDv7 generated in the app, DATA-1; money as `numeric`; prices `numeric(18,6)`, totals `numeric(14,2)`, quantities `numeric(14,4)`):

- platform: `installation_configuration_version` (id, version_label, source_kind, payload jsonb, content_hash, synced_at, is_current — exactly one current), `sync_state` (entity PK, status, last_success_at, last_attempt_at, cursor jsonb, last_full_reconcile_at, row_count, last_error_class, last_error_message)
- iam (dev auth, see §6): `account` (id, email unique-ci, display_name, password_hash Argon2id, role admin|manager|seller, status, created_at), `session` (id, account_id, token_hash, expires_at, created_at, last_seen_at, revoked_at), `account_seller_link` (account_id, seller_code, config_version_id, PK account_id), `audit_log` (id, at, actor_account_id, action, detail jsonb — login success/failure/logout)
- mirror (source-of-truth is Sankhya; local read model): `erp_seller`, `erp_customer` (incl. `price_table_code` nullable = "no resolved table", credit_limit, active, seller_code, blocked flag stored raw), `erp_product` (incl. raw `usage_code`, active, group_code/name, unit, brand, reference), `erp_price_table` (code, name, active, origin_table_code, percent), `erp_price_table_version` (version_id, table_code, effective_from), `erp_list_price` (version_id, product_code, unit_price ≥ 0). **Absent row = "no price"; explicit 0 row = "zero price" — kept distinct.** Each mirror table: `content_hash`, `source_changed_at`, `synced_at`, `deleted_at` (soft, reconciliation-driven).
- orders: `sales_order` (id, draft_number identity, customer_code, seller_code, created_by_account_id, status `draft|cancelled|queued|sent|rejected|unknown` — only draft/cancelled reachable today, negotiation_type_code, notes, estimated_total numeric(14,2), version int, client_request_id unique, external_origin_id text NULL unique — **unresolved integration point (SNK-5), never populated today**, erp_number NULL (NUNOTA), config_version_id, created_at, updated_at), `sales_order_item` (id, order_id, line_no, product_code, product_description, unit, quantity, unit_list_price NULL, price_state priced|zero|none, price_table_code, price_version_id, estimated_line_total NULL)
- integration: `integration_outbox` (id, aggregate_type, aggregate_id, operation, payload jsonb, origin_id NULL, status `pending|processing|confirmed|rejected|unknown`, attempt_count, next_attempt_at, last_error_class, last_error_message, erp_reference NULL, created_at, updated_at) — foundation only, **nothing enqueues into it today**.

Migration runner: one-shot CLI (`pnpm db:migrate`), `pg_advisory_lock` protected, clear failure messages; `drizzle-kit push` never used.

## 6. Authentication (dev-safe, isolated)

`AuthProvider` interface; `DevPasswordAuthProvider` is the only implementation today: seeded accounts (Argon2id hashes generated at seed time from `SEED_DEV_PASSWORD` env — no committed password), opaque server-side sessions (random token, only its hash stored, HttpOnly + SameSite=Lax cookie, `Secure` outside local), login rate limit, audit events. Starts only if `AUTH_MODE=dev`; the server **refuses to boot** with `AUTH_MODE=dev` when `NODE_ENV=production` (no override flag exists). The web shows a visible "Ambiente de desenvolvimento — autenticação de desenvolvimento" banner on the login page. This is not the production auth design (AUTH-x PROPOSED; full RBAC is WP 0.5).
Scope (P-21) enforced in the API: role `seller` sees only customers whose seller is linked to the account per the configuration; `manager`/`admin` see all (team tree is later). Never rely on UI filtering. Cost/margin never exist in any contract (P-20).

## 7. API (`/api/v1`, JSON, pt-BR messages, Zod-validated, errors as `{code,message,details?}`)

- `GET /health` (liveness), `GET /ready` (DB + migration level + integration summary; degraded ≠ down when Sankhya is unavailable)
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`
- `GET /configuration` (config snapshot summary safe for clients + sync state + gateway mode) — no secrets ever
- `GET /dashboard`
- `GET /sellers`, `GET /customers` (search, status, sellerCode, hasPriceTable, sort, page, pageSize), `GET /customers/:code`
- `GET /product-groups`, `GET /products` (search, group, sellable, priceState, customerCode → price context, page…), `GET /products/:code`
- `GET /orders` (search, status, customerCode, page…), `POST /orders` (create draft, `clientRequestId` idempotent), `GET /orders/:id`, `PUT /orders/:id` (full draft replace, `expectedVersion` optimistic concurrency, server recomputes prices from mirror + totals with `domain`; client-sent prices ignored), `DELETE /orders/:id` (discard → `cancelled`), `POST /orders/:id/submit` → always `409 erp_submission_disabled`
- Price context for a customer: the customer's `price_table_code`; null → per `pricing.fallbackStrategy`; else no resolved table → items are `none`. Effective version = latest `effective_from ≤ now` per table (F-39). Order-line rule: `none`/`zero` lines are orderable only if configuration allows (server-side).
- Totals are **estimates from list price** (`quantity × unit_list_price`, half-up to 2 decimals, exact decimal arithmetic) and always labelled "Estimativa pela tabela de preço de lista — o valor final é calculado pelo ERP". No universal VLRNOTA/VLRDESC formula (F-12…F-14).

## 8. Web (Portuguese pt-BR, desktop-first, blueprint MK-01…MK-05, W-01/05/07/08/14/16/17/18/22/31/38)

Routes: `/login`, `/` (dashboard), `/clientes`, `/clientes/:code`, `/produtos`, `/pedidos`, `/pedidos/novo`, `/pedidos/:id` (view/edit draft), `/integracao` (configuration + integration state). Shell: sidebar, top bar with context/breadcrumbs, user menu, integration-state pill, responsive. Every data page has loading / empty / error states. Order editor shows list price ≠ transactional price, missing/zero price distinctly, guarded ERP button: "Envio ao ERP aguardando conclusão da integração segura".

## 9. Order/outbox foundation (no user-facing ERP send)

Domain: `OrderStatus`, `OutboxStatus`, transition tables (pure). Statuses beyond draft/cancelled exist as types/columns only. The origin-id field name is not chosen (SNK-5): the gateway `submitOrder` port is declared but has no implementation; `external_origin_id` stays NULL.

## 10. Operability

Structured JSON logs (pino, secrets redacted), env validation at boot with clear errors (Zod), `/health`, `/ready`, worker heartbeat + sync-state, graceful shutdown, integration failures never crash the API.

## 11. Deployment

`deploy/docker-compose.yml` (services `web`, `api`, `worker`, `migrate` one-shot, `postgres`), `.env.example` only (no real env files), nginx serving the SPA and proxying `/api`, `scripts/` (bootstrap, migrate, seed-demo). Images `salesforce-api|worker|web` (no customer name). A second installation is `docker compose -p salesforce-<name> --env-file <name>.env …` with its own volume, DB, Sankhya credentials, configuration source.
