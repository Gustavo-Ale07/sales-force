# "Configuração Sales Force" — proposed Sankhya-side contract

> **Status: PROPOSED — U-10 / U-11 (`docs/decisions.md`).** Documentation of the Sales Force side of CFG-1. It does **not** authorize creating anything in any Sankhya environment. No DDL is included or implied; creating custom tables/screens follows a separately approved integration/configuration workflow (Sandbox first, SNK-3). Source of the requirement: owner rulings of 2026-09-18 (PROD-1, CFG-1…CFG-6).

## 1. Principle

Each customer's Sankhya is the source of truth for that installation's commercial configuration. Sales Force reads it (worker → `SankhyaGateway.readConfiguration()`), validates it against the `InstallationConfiguration` schema (`packages/contracts`), and stores a **versioned snapshot** in PostgreSQL (`installation_configuration_version`). The API and domain use only the local snapshot, never Sankhya, on request paths. **Secrets are never part of this configuration** (Client Secret, `X-Token`, database and signing/encryption secrets stay in the installation's environment/secret store; P-22, SEC-1).

Until the Sankhya-side model exists, the snapshot can come from a `bootstrap-file` or `demo` source (U-11). Both use exactly the same schema and are labelled in `source.kind`; the UI shows which source is active.

## 2. Logical structure (what the future screen must expose)

Logical groups → one header record per installation plus child rows where a list is needed. Physical names are intentionally not proposed here (U-10).

| Group | Fields (logical) | Notes |
|---|---|---|
| **Geral** | `enabled`; `configVersion` (monotonic, bumped on every save); enabled companies (list of company codes) | `configVersion` and `updatedAt` are what the mirror stores as source markers |
| **Vendas** | order TOP; quotation TOP (optional); default negotiation type; allowed negotiation types (list); order behavior (allow draft without price); confirmation behavior (`manual`/`automatic`/`disabled`) | None of these has a universal value; the Sandbox values are test evidence only (CFG-6) |
| **Clientes** | portfolio ownership strategy (`customer_seller_field`/`explicit_account_links`/`all_visible`); account → seller links (list: account e-mail, seller code); customer-without-price-table behavior (`no_resolved_table`/`use_fallback_table`); credit-related switches (show credit limit) | `TSIUSU.CODVEND` is a reference, not the mapping (CFG-2) |
| **Produtos** | allowed product-use values (list of codes); show inactive (bool); product-without-price: visible (bool), orderable (bool) | Sellable ≠ `('V','R')` universally (CFG-3) |
| **Preços** | customer price-table strategy; fallback strategy (`none`/`fixed_table`) and fallback table; catalog reference table (for browsing without a customer); missing-price behavior (`no_price_state`) | Null `CODTAB` = no resolved table until a fallback is configured (CFG-4); missing price shown "Sem preço", never R$ 0,00 (CFG-5) |
| **Financeiro** | show financial area; overdue-titles feature; credit-check feature | Switches only; the rules behind them stay UNDECIDED (S4) |
| **Recursos** | installation feature flags (name → on/off) | Known keys are typed in Sales Force; unknown keys are ignored and reported |

## 3. Screen contract ("Configuração Sales Force")

- One screen per Sankhya installation, restricted to administrative profiles chosen by the customer in Sankhya.
- Every save creates a new `configVersion` and an audit trail entry in Sankhya (who/when/what changed).
- The screen validates required combinations before saving (for example fixed-table fallback requires a fallback table; `orderable` products without price require an order behavior that accepts them).
- No secrets, no credentials, no free-form script/expressions.
- Deleting a record used by a released snapshot is prevented or versioned; Sales Force never edits Sankhya configuration (read-only, P-02/P-03).

## 4. Delivery contract to Sales Force

1. `readConfiguration()` returns one complete, self-consistent snapshot (`source.kind='sankhya'`, `source.version=configVersion`, `syncedAt`). No partial or paged config.
2. The worker compares the snapshot's content hash with the current local version; a changed hash inserts a new `installation_configuration_version` row and flips `is_current` in one transaction. An invalid snapshot is rejected, the previous version stays current, and the failure is recorded in `sync_state` (`entity='configuration'`).
3. A configuration change that would **widen a user's scope** (for example new account → seller links) is written to the audit log with the old and new version before it takes effect (proposed guard-rail from the CFG-2 security note; not approved).
4. Cadence and manual "sync now" trigger: proposed every few minutes plus on demand from the integration page; final cadence NEEDS VALIDATION with the customer.

## 5. Open points (owner / customer input)

- Physical model (table/screen, editors, profiles) — U-10.
- Which source seeds the first installation before the model exists — U-11.
- Whether some settings are per company (multi-company customers) rather than per installation.
- Origin-id field used by future ERP submissions is **not** part of this contract (SNK-5, U-12).
