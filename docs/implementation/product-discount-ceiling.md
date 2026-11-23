# Product discount ceiling (TGFPRO.DESCMAX) and the Force's own discount approval flow

Status: implemented as an informational, additive field (2026-11-23). Facts: `docs/sankhya-spike.md` 9.62. Related: P-10, D-M (APPROVED), DISC-2..6.

## 1. What was added

- Source: `TGFPRO.DESCMAX` (percent), read by the worker's product mirror (SELECT only). `DESCMAXFLEX` is NOT read (meaning unknown, NEEDS VALIDATION).
- Mirror: `erp_product.max_discount_percent numeric(7,4)` null (migration `0043_erp_product_max_discount`, expand-only; table-level grants already cover it, `deploy/staging/db-roles.sql` needs no change).
- Contract: optional additive `maxDiscountPercent?: string | null` on `ProductListItem` (so also `ProductDetail`, resolution results and everything the web and the mobile sync read from the catalog). Decimal text, e.g. `"12"`. `null` or absent = no limit registered = no warning. Old clients ignore it.
- Not restricted data (P-20): it is a commercial policy attribute of the product, not cost, margin or commission; the restricted-key detector stays clean with the field present.
- No fixed limit in code or configuration: Sankhya is the only source. Deploy order: server (migration, worker sync, API) first, then the OTA that reads the field; until the first product sync after the deploy the field is `null` everywhere.
- To confirm with the owner: null = "no limit registered" produces no warning (1591 of 3789 active Sandbox products).

## 2. The Force's own approval flow today (mode `force` only)

Switch: `sales.discountAuthority.mode` (`erp` | `force`), default `erp` (D-M, APPROVED; `packages/domain/src/configuration.ts:77-79`, read by `discountAuthorityModeOf`, `discount-authority.ts:50`). It already exists and is already the off switch; no new key is needed.

- `erp` (default): `recomputeOrderAuthority` returns `within_authority` immediately (`discount-authority.ts:167`); `OrdersService.submit` skips the recompute (`orders.service.ts:745-746`); no `awaiting_approval`, no `discount_blocked`; the approval and limits endpoints answer 404 (`approvals.service.ts:34`, `discount-limits.service.ts:93`). The clients hide the approval screens and show the ERP note (web `force-mode-gate.tsx`, mobile `approval-status.ts`).
- `force`: on save the server stores `needs_manager` / `needs_director` / `blocked` from the lines (`orders.service.ts:250`, `:554`); on submit (`:745-763`) above the director ceiling it throws 409 `discount_blocked` (`:747-754`), above the owner's authority it moves the order to `awaiting_approval` with one approval request (`requestApproval`, `:852-870`) and the ERP delivery waits for a manager/director decision (`approvals.service.ts:120-131`). Limits are Force configuration (5/15/30 provisional), not the product `DESCMAX`.

Does the server block or change state for an item discount above `DESCMAX`? No, in any mode: `DESCMAX` is not read by any order rule. In `erp` mode nothing blocks on discount (only the structural 0-99.99 % and "sem preço"). In `force` mode only the Force limits matter, never the product ceiling.

Proposal: none needed. Keep `erp` as the installation mode (the default); the code stays. The `DESCMAX` warning is a client-side hint only; if the owner later wants it enforced it must be a new decision (blocking vs. routing to the ERP release, meaning of null/0 and of `DESCMAXFLEX`).
