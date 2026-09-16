# Sankhya Spike — Findings and Open Questions

**Responsibility of this file:** the record of what is **validated** about the company's Sankhya environment, which project decisions constrain the integration, and what still **needs validation**.

**Last updated:** 2026-09-16

---

## 0. Rules for this document

1. Nothing about Sankhya behavior is assumed. A fact is recorded as VALIDATED only with evidence (documentation link, recorded sanitized response, or dated observation in the company's environment).
2. Documentation-level evidence is weaker than environment evidence. Such facts are marked "VALIDATED (docs)" and must be confirmed in the company's environment.
3. Table names are candidates, not API behavior. A table name alone never defines how the integration works.
4. TOP, company code, price rules, service names, mandatory fields, goal/commission sources are **never** invented. Unknown items stay NEEDS VALIDATION and block the features that depend on them.
5. Raw captures containing real data go to `.sankhya-raw/` (git-ignored) and are never committed. Only sanitized fixtures are committed (§6).

### Status values

| Status | Meaning |
|---|---|
| VALIDATED (env) | Observed in the company's Sankhya environment, with evidence |
| VALIDATED (docs) | Stated in official Sankhya documentation; confirm in the environment |
| NEEDS VALIDATION | Not yet validated — never presented as fact |

Project decisions about the integration are not Sankhya facts; their status (APPROVED / PROPOSED / UNDECIDED) comes from `decisions.md`.

---

## 1. Project decisions that constrain the spike

| Ref | Status | Topic | Detail |
|---|---|---|---|
| P-03 | APPROVED | Boundary | Web and mobile never communicate with Sankhya; Sankhya-specific implementation isolated behind `packages/sankhya` / `SankhyaGateway` |
| SNK-3 | APPROVED | Staging and development environment | Homologation if it exists; otherwise staging and local development use the fake gateway with sanitized fixtures (CI always fake); isolated real non-production environment added before the pilot if available (mandatory? U-04); staging never writes to production; no production data in staging without approved sanitization; production as staging — including read-only — **REJECTED** |
| SNK-4 | APPROVED | Write idempotency | Custom origin-id field(s) holding the Sales Force identifier, checked before any retry (required); native idempotency in addition if S0 confirms it; heuristic primary matching **REJECTED**; observation field only as emergency fallback (U-05…U-07); validated in S0 before any real order write |
| U-03 | UNDECIDED | Read-only production inspection during spikes | SNK-3 rejects read-only production use; a later owner instruction allows strictly read-only inspection only if explicitly authorized. **Until resolved, no production access of any kind.** |
| SNK-1 | PROPOSED | Integration boundary detail | Writes only via `integration_outbox` + worker; user reads from the mirror; synchronous API calls only from an allowlist (empty); Sankhya formats stay in `packages/sankhya` |
| SNK-2 | PROPOSED | Authentication | OAuth 2.0 client credentials + `X-Token` (F-01, docs level); legacy appkey/token not implemented; API per operation chosen by S1 |
| DATA-3 | PROPOSED | Mirror identifiers | Deterministic UUIDv5 from the Sankhya natural key; unique constraint on the natural key |
| SYNC-2 | PROPOSED | Mirror writes | Upsert only when content hash changed |

---

## 2. Validated facts

| ID | Fact | Status | Evidence | Confirm in environment |
|---|---|---|---|---|
| F-01 | The Sankhya API gateway authenticates with OAuth 2.0 client credentials: `client_id` and `client_secret` (Developer area) plus `X-Token` (Gateway settings screen in Sankhya Om). This replaces the appkey + token model. The response returns a bearer access token with an expiry. | VALIDATED (docs) | [Authentication reference](https://developer.sankhya.com.br/reference/post_authenticate) · [Changelog: new OAuth flow](https://developer.sankhya.com.br/changelog/novo-fluxo-de-autenticacao-com-oauth-20) · [How to obtain credentials](https://ajuda.sankhya.com.br/hc/pt-br/articles/39368763917463-Como-obter-as-credenciais-necess%C3%A1rias-para-integra%C3%A7%C3%A3o-via-API-Gateway) | Token lifetime in our environment; credential issuance for staging vs production |

No other Sankhya behavior is validated yet.

---

## 3. Spikes

All spikes are **NEEDS VALIDATION**. Each has questions, an exit criterion and what it blocks.

### S0 — Commercial and environment (with the Sankhya partner/executive)

**Start immediately; non-technical; long lead time.**

| # | Question | Status |
|---|---|---|
| S0.1 | Does a homologation environment exist for our Sankhya contract? If not, can an isolated real non-production environment (e.g. a separate test database) be provided through the partner, and at what cost? | NEEDS VALIDATION |
| S0.2 | What are the API request limits (per minute/hour/day, concurrency)? | NEEDS VALIDATION |
| S0.3 | Is there a cost per integration, per API user or per request? | NEEDS VALIDATION |
| S0.4 | Is the company authorized to create custom additional fields on the order header and partner records, and can the partner support it? | NEEDS VALIDATION |
| S0.5 | Does Sankhya offer native idempotency for document or partner insertion? | NEEDS VALIDATION |
| S0.6 | Maintenance windows and support channel for integration incidents | NEEDS VALIDATION |

- **Exit criterion:** written answers from the partner/executive recorded in §7.
- **Blocks:** S1–S6; SNK-3 (staging environment); SNK-4 (Sankhya writes).
- **Validation IDs:** V-11, V-13.

### S1 — API choice, reads and change detection

| # | Question | Status |
|---|---|---|
| S1.1 | For each operation, which API is used: REST v1 or gateway services? Criteria: support for custom fields, confirmation behavior, incremental reads, error messages. | NEEDS VALIDATION |
| S1.2 | For each Phase 0 mirror entity: service, filters, pagination, incremental cursor (change date, increasing key, other). | NEEDS VALIDATION |
| S1.3 | How are deletions detected per entity? | NEEDS VALIDATION |
| S1.4 | Error format; behavior on rate limiting (status codes, headers, retry hints); authentication expiry behavior. | NEEDS VALIDATION |
| S1.5 | Measured latency and throughput per entity; feasibility of daily reconciliation within the night window. | NEEDS VALIDATION |
| S1.6 | Token lifetime and renewal behavior in our environment (confirms F-01). | NEEDS VALIDATION |

- **Candidate tables to validate** (not assumptions): `TGFPAR` (partners), `TGFVEN` (sellers), `TGFPRO` (products), `TGFTAB` / `TGFEXC` (prices), `TGFCAB` / `TGFITE` (document header/items), `TGFFIN` (financial titles).
- **Exit criterion:** entity → method → cursor → deletion detection table (§4) filled with measured timings and recorded sanitized samples.
- **Blocks:** Phase 0 mirror implementation against a real environment (V-12).

### S2 — Price resolution, rounding and taxes

| # | Question | Status |
|---|---|---|
| S2.1 | The real price resolution rule in the company's configuration: dependence on company, TOP, payment/negotiation type, partner or product exceptions, quantity ranges, region, partner-linked table, minimum price, maximum discount. | NEEDS VALIDATION |
| S2.2 | 50–100 real cases (customer, product, quantity, condition → Sankhya price), sanitized, recorded as acceptance tests for `packages/domain`. | NEEDS VALIDATION |
| S2.3 | Rounding rule (per item or total) and decimal precision of prices, percentages and quantities. | NEEDS VALIDATION |
| S2.4 | Can Sankhya simulate taxes (IPI, ICMS-ST) for a quotation before an order exists? | NEEDS VALIDATION |

- **Exit criterion:** recorded cases; rounding rule documented; R30 and R31 ready for decision.
- **Blocks:** pricing in `packages/domain`, quotations and orders (Phase 1); percentage/quantity precision in DATA-3.

### S3 — Order lifecycle

| # | Question | Status |
|---|---|---|
| S3.1 | Mandatory fields for order insertion; TOP and company to use for Sales Force orders. | NEEDS VALIDATION |
| S3.2 | Is an inserted order pending confirmation? Who confirms, and how (API, manual, TOP rule)? | NEEDS VALIDATION |
| S3.3 | Invoicing: link between order and invoice document(s); partial invoicing; cut items. | NEEDS VALIDATION |
| S3.4 | Cancellation after insertion and how it is observed. | NEEDS VALIDATION |

- **Exit criterion:** state diagram validated with one real order in the non-production environment.
- **Blocks:** order submission and status tracking (Phase 1); R24, R25.

### S4 — Limit releases and credit

| # | Question | Status |
|---|---|---|
| S4.1 | Which native "liberação de limites" events can fire on orders (discount, credit, minimum price)? | NEEDS VALIDATION |
| S4.2 | Can a dedicated TOP for Sales Force orders avoid those events (or create them already released)? | NEEDS VALIDATION |
| S4.3 | The formula for available credit (limit, open titles, pending orders). | NEEDS VALIDATION |

- **Exit criterion:** R26 and R38 ready for decision.
- **Blocks:** approval flow and credit checks (Phase 1).

### S5 — Partner registration

| # | Question | Status |
|---|---|---|
| S5.1 | Mandatory partner fields in the company's configuration. | NEEDS VALIDATION |
| S5.2 | Coded address data (city, neighborhood, street) and how to resolve them from a postal code. | NEEDS VALIDATION |
| S5.3 | Fiscal data required (state registration, ICMS contributor indicator, tax regime, classification). | NEEDS VALIDATION |
| S5.4 | Definition of the custom idempotency field on the partner (depends on S0.4). | NEEDS VALIDATION |

- **Exit criterion:** field list split into seller-collected vs approval-completed data; R27 ready for decision.
- **Blocks:** new customer creation (Phase 1).

### S6 — Goals, positivization and commissions

| # | Question | Status |
|---|---|---|
| S6.1 | Where goals are stored; granularity (value/volume, period, product/group); update frequency. | NEEDS VALIDATION |
| S6.2 | Whether positivization exists as data in Sankhya or must be counted from invoices. | NEEDS VALIDATION |
| S6.3 | Where commissions are stored; forecast vs released; whether only available after period closing. | NEEDS VALIDATION |

- **Exit criterion:** source per indicator; R28 ready for decision.
- **Blocks:** goals, positivization and commissions screens (Phase 1).

---

## 4. Phase 0 mirror entity map

To be filled by S1. Frequencies are the spec's initial values (RF-SNK-1) and remain PROPOSED until S0.2 limits are known.

| Sales Force entity | Sankhya source | Read method | Incremental cursor | Deletion detection | Proposed frequency | Status |
|---|---|---|---|---|---|---|
| Sellers | NEEDS VALIDATION (candidate `TGFVEN`) | NEEDS VALIDATION | NEEDS VALIDATION | NEEDS VALIDATION | 15 min | NEEDS VALIDATION |
| Customers / partners and portfolio | NEEDS VALIDATION (candidate `TGFPAR`) | NEEDS VALIDATION | NEEDS VALIDATION | NEEDS VALIDATION | 10 min | NEEDS VALIDATION |
| Products | NEEDS VALIDATION (candidate `TGFPRO`) | NEEDS VALIDATION | NEEDS VALIDATION | NEEDS VALIDATION | 15 min | NEEDS VALIDATION |
| Price tables | NEEDS VALIDATION (candidates `TGFTAB`, `TGFEXC`) | NEEDS VALIDATION | NEEDS VALIDATION | NEEDS VALIDATION | 10 min | NEEDS VALIDATION |

Whether financial titles, sales documents and goals/commissions are mirrored in Phase 0 is an open scope question (`roadmap.md` Q-02).

---

## 5. Request limits and concurrency

| Item | Value | Status |
|---|---|---|
| Requests per time unit | — | NEEDS VALIDATION (S0.2, S1.5) |
| Allowed concurrency | — | NEEDS VALIDATION |
| Rate-limit signal | — | NEEDS VALIDATION (S1.4) |

Until measured, the worker serializes Sankhya requests and backs off on rate-limit and server errors.

---

## 6. Fixture policy

1. Raw responses are captured only into `.sankhya-raw/` (git-ignored), from a non-production environment. Production access of any kind, including read-only inspection, is UNDECIDED (U-03) and not performed until resolved.
2. Before committing, fixtures are sanitized: CNPJ/CPF, names, trade names, addresses, emails, phones and free-text notes replaced with synthetic values; identifiers remapped consistently; monetary values kept only when needed by a test.
3. Committed fixtures live in `packages/sankhya` with provenance: spike, operation, date, environment type.
4. Credentials, tokens and `X-Token` values never appear in fixtures, logs or this document.

---

## 7. Findings log

Append-only. One row per finding, with evidence.

| Date | Spike | Finding | Evidence | Recorded by |
|---|---|---|---|---|
| 2026-09-16 | — | F-01 authentication model from official documentation | Links in §2 | Decision session |
