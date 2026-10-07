# MOBILE_SALES_FORCE_PARITY — working note (not a decision, not committed)

Source: owner message 2026-09-30 + addendum. Vidya mobile screenshots = reference for flow / information architecture only.
No pixel-perfect copy, no Vidya branding. Force/PLAC identity, existing design system, offline-first.
**Starts only after the offline slice is fully closed** (real M55 flow: airplane mode -> draft -> force-stop -> reopen -> sync -> no duplicate).
Do not rewrite SQLCipher / mobile-db / cache / outbox / sync / idempotency / conflicts: UI consumes the existing ports.
No push, no merge. Test affected suites first; M55 QA after each milestone when needed; no monorepo re-audit.

## Order (addendum P)
- M1 **CLOSED (2026-09-30, local commits only)** Shell + native/JS splash + login + bottom nav (Inicio, Clientes, Vendas, Catalogo, Perfil) + Perfil (sync area, version/env badge) + compact sync status. M55 QA: login, draft nº 6 kept, offline entry + message + "Offline" chip, local Vendas/Clientes/Catalogo offline, sync sheet, return online = Sincronizado. Not verified: native-only first frame isolated; sheet error state on device; dark theme (out of scope).
- M2 **CLOSED (2026-09-30, local commit only)** Inicio + Clientes: Home with real quick actions (Novo pedido, Retomar pedido, Sincronizar agora), local counters (pedidos locais, pendencias, clientes, produtos), Performance/Engajamento as empty states (no invented metrics); Clientes compact cards, visible search (name/code/document, offline from cache), loading/empty/no-result/error states, keyboard fixes. M55 QA: Home online/offline, actions, counters, search online/offline, no-result, keyboard dismiss on drag/Enter, scroll, bottom nav, reconnection = Sincronizado. Deferred to M3: alphabetical index, filters, customer sheet. Not verified: "Sincronizando" state after tapping Sincronizar agora (finished too fast to capture).
- M3 CLOSED — Clientes + ficha + filters + alphabetical index (Mapa gated by valid geolocation: BLOCKED_BY_GEO_DATA)
- M4 Catalogo visual: grid/list, group filter sheet (real hierarchy, multi-select), images (lazy, cache, placeholder, offline-safe) — CLOSED 2026-09-30 (grade/lista, filtros Grupo+Preço, imagem só placeholder; hierarquia/imagem/promoção BLOCKED; A–Z e detalhe não feitos)
- M5 Vendas **CLOSED (2026-09-30; commits 87b9f9d, fe83cb2)**: Nao enviados / Enviados (Enviados = aceito pelo Force, nao ERP), filtros (cliente, periodo, situacao), busca, resumo (qtd / total ou valor estimado / atualizado), detalhe, Continuar / Duplicar / Excluir rascunho / Reenviar. ERP docs (Orcamento, Pedido ERP, Nota) = BLOCKED_BY_ERP_MIRROR. M55 QA online + aviao + reconexao OK (offline -> Pedido nº 8, 1 so). Evidencia DEV read-only: sales_order 8 linhas / 8 client_request_id distintos (indice unico), nº 8 unico (cliente 40156, 971.07, criado 18:07:40Z = reconexao), 1 POST /api/v1/orders por pedido nos logs, sem lacuna de draft_number. Home: Retomar pedido nunca oferece pedido sincronizado; segmento Minhas vendas fecha o detalhe. Lacunas: busca sensivel a acento; pedidos criados na web nao listados; Duplicar zera descontos; divida PRICE_DISPLAY_PRECISION.
- M6 Novo pedido: Cabecalho -> Produtos -> Carrinho as steps of ONE draft, continuous local save, sticky total CTA, clear order actions (excluir != descartar), discounts only via @salesforce/domain
- M7 Dashboard / Relatorios / refinements / QA on the M55

## Rules
- Show only metrics with a real source; never fake ERP-mirror data or "low performance" claims.
- No decorative buttons: CREATE_CUSTOMER, VOICE_SEARCH, COMMUNICATION_BOARD, Mapa, Import (CSV/TXT/XLSX/XLSM/PDF text) stay registered/blocked until defined.
- Order header fields map to real domain/backend/config only (no invented TOP, company, carrier).
- Keyboard audit (KeyboardAvoidingView, sticky CTA, bottom nav, safe area), one primary action instead of stacked FABs, bottom sheets not shrunken desktop modals.
- Offline: never block the whole UI; explain impossible actions.
- Screenshots: keep under `.claude/references/` per existing workflow, never versioned without policy check.
- First sync UX shows real progress steps only; "Sincronizar agora" reuses real sync-manager states.
