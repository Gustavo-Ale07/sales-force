# Order status following Sankhya (backend, 2026-11-23)

Status: implemented backend/worker/contract; no UI yet. Facts and open validations: `docs/sankhya-spike.md` 9.60.

## Stages (`packages/domain/src/order-stage.ts`)

Enviado ao Force, Erro no envio (from the outbox, before a note exists), Orçamento no Sankhya (quotation TOP from `sales.quotationTopCode`, number only, no timeline), Recebido no Sankhya, Em revisão (Pedidos), Conferência financeira (Financeiro), Na expedição, No faturamento, Faturado. Precedence in spike 9.60. Review events, sector labels and the final re-read window (default 24 h) are `erp.orderStage` configuration.

## Flow

- Worker (`OrderErpStatusJob`, existing cron) and the on-demand refresh step `orderStatus` (`POST /sync/refresh`, real login and "Sincronizar agora") call `OrderErpStatusService.runOrderStageOnce`: one batched read through `SankhyaOrderReadPort.readOrderStageFacts` (SELECT only), classified by the domain, stored in `sales_order_erp_stage` (migration 0040, expand-only). `updated_at` moves only when the content hash changes; `checked_at` on every read. On-demand reads reuse a read up to 60 s old. Invoiced orders are re-read only inside the window.
- Contract: optional/nullable `erpStage` on order list items and details {stage, label, pendingSector, nunota, invoiceNumber, updatedAt, checkedAt, readError}. Named `erpStage` because `erpStatus` already holds the legacy code/label. Devices get it through the existing orders sync; offline shows the last known stage with its time. No sync protocol change.
- Errors: Sankhya down or no access keeps the last stage and records `readError` {errorClass, errorCode, at}; a first read that fails surfaces as a failed `orderStatus` refresh step with a stable code.

## What the screen will NOT show

Cost or margin, other sellers' orders, event names (unvalidated), denied/"barrado" state, cancelled notes, a link from a converted quotation to its original, `AD_STATUS`/`AD_FAROL`/`AD_EXPEDICAO`.

## Stage filter on the order list

`GET /orders?stage=<code>` (additive, optional; codes = `ORDER_STAGE_CODES`). Stored mirror stages (`sales_order_erp_stage`: received, in_review, financial_check, in_dispatch, in_invoicing, invoiced, quotation) filter on the mirror; `sent_to_force` (queued) and `send_error` (rejected) are derived: no mirror row, no ERP number, matching status. Same caller scope as before; `total` follows the filter; an unknown code is 400.

## Release queue

The same read feeds the internal "Aguardando liberação" queue (pending TSILIB lines with event, cascade level and assigned releaser): `docs/implementation/release-queue.md`.

## Deploy order

Apply migration 0040 and the `deploy/staging/db-roles.sql` grants, then server (API + worker), then OTA/mobile. The contract change is additive.
