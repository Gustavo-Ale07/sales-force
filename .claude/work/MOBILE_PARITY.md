# MOBILE_PARITY (working note, not committed)

Audit of `apps/mobile` against the web (`WEB_PARITY.md`) and the Vidya reference (`VIDYA_PARITY_MATRIX.md`). Date 2026-10-01.
Classes: REQUIRED · P1 · NOT_NEEDED. State: DONE (already on mobile or done this round) · OPEN. Mobile consumes existing ports only; no schema, protocol or server change.

| # | Area | Class | State | Notes |
|---|---|---|---|---|
| 1 | Sales list / detail (Nao enviados, Enviados, filters, search, summary) | REQUIRED | DONE | Local drafts only. Orders created on the web are not listed (known gap, see 12). |
| 2 | Sales status wording | REQUIRED | DONE this round | Draft / Na fila / Enviando / Enviado ao Force / Requer atencao / Cliente indisponivel. Mobile never says ERP, faturado, confirmado or "sincronizado com o ERP": the device carries no ERP stage. Distinct labels for "awaiting ERP", "synced with ERP", "ERP confirmed", "ERP invoiced" are NOT created because no field on the device supports them (BLOCKED by SNK-6 and the missing ERP status in the order DTO). |
| 3 | Customer ineligible (blocked/inactive) draft | REQUIRED | DONE this round (local guard) | Held locally with "Cliente indisponivel - revise o rascunho", nothing sent, nothing converted or deleted, re-evaluated on every run, same idempotency key. Server `customer_ineligible` (409) is mapped as permanent with the same wording. The server `review` field (order list/detail) is not consumed by mobile: mobile does not list server orders. |
| 4 | Duplicate sale | REQUIRED | DONE | In the sale detail. Resets discounts (P-10, R35/R36 open), prices come from the local cache. |
| 5 | Repeat last order (customer shortcut) | P1 | OPEN | The web calls `repeat-last` online. On mobile "Duplicar" of any sale already covers the need; a shortcut on the customer screen that picks the customer's most recent LOCAL sale is small, but it only sees sales made on this device (web orders are not pulled). Not implemented: it would suggest a "last order" that may be wrong. Needs the server order history to reach the device first. |
| 6 | Order templates / recurring orders | P1 | OPEN | Web templates are server-backed (online endpoints). They are not in the approved sync protocol: offline use needs a template dataset in pull, which is a protocol change (architect, R10/R11 interim rule). An online-only mobile version would break offline-first. Not implemented. |
| 7 | Profile | REQUIRED | DONE (read/sign-out) | Name, saved orders on this device, sync area, version/env badge, sign out. Password change / edit: no endpoint (AUTH-x PROPOSED), NOT_NEEDED for now. |
| 8 | Sign-out | REQUIRED | DONE this round | No "leave anyway". Remote logout failure: error, stays signed in, retry; DB and drafts never wiped automatically. |
| 9 | Sync | REQUIRED | DONE | Compact status, sync sheet, manual sync, offline chip, retention cleanup that keeps outbox-referenced rows. Open: "Tentar enviar novamente" only triggers a sync; it does not re-queue REJECTED commands (existing limitation, needs an explicit re-queue or edit-and-resave flow). |
| 10 | Retained / quarantined orders | REQUIRED | DONE | Quarantine screen from Profile (dataset change, revoked scope). |
| 11 | Catalog (grid/list, search, group and price filters) | REQUIRED | DONE | Thumbnails: authenticated, private file cache, LRU bounds; purge on sign-out and owner/dataset change, not on mere session expiry of the same owner (hardened and tested this round). Hierarchy, promotion, image detail: BLOCKED by data. |
| 12 | Customers (list, search, filters, A-Z, detail) | REQUIRED | DONE | Map gated by valid geolocation (BLOCKED_BY_GEO_DATA). |
| 13 | Orders created on the web shown on mobile | P1 | OPEN | Requires pulling orders into the device (protocol). |
| 14 | ERP stages (quote, ERP order, invoice) | BLOCKED | OPEN | SNK-6 / V-11 / V-13. Do not show. |
| 15 | Print / share PDF, export | NOT_NEEDED | n/a | Representatives have no export (P-20). |
| 16 | Agenda, Mural, Engajamento, Performance, Notifications | NOT_NEEDED por ora | n/a | No source; Home shows honest empty states. |
| 17 | Stock, route, GPS check-in, POS photo | NOT_NEEDED | n/a | Out of scope (P-13). |
