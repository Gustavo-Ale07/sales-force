# M5 — Mapa de dados de vendas (mobile)

Fonte única no aparelho: `local_order_draft` + `local_order_item` + `outbox` (SQLCipher, `packages/mobile-db`).
O mobile NÃO tem listagem de pedidos do servidor (`OrderRepository` = create/get/replace/getEntryConfiguration).
`GET /orders` existe no servidor/web mas não é consumido pelo mobile e não funciona offline. Pedidos criados
fora do aparelho (web) não aparecem na Central de Vendas (gap registrado, exigiria sync de pedidos — fora do M5).
`integration_outbox`/ERP: desligado (`erpNumber` sempre null). Nenhum espelho ERP de orçamento/pedido/nota.

| Dado | Classe | Origem |
|---|---|---|
| ID local | AVAILABLE_LOCAL | local_order_draft.local_id |
| ID remoto / versão | AVAILABLE_FORCE_BACKEND | remote_id / remote_version (após sync) |
| Número do pedido | AVAILABLE_FORCE_BACKEND | remote_draft_number (só após sync; antes: "sem número") |
| Cliente (código, nome) | AVAILABLE_LOCAL | customer_code / customer_name |
| Data | AVAILABLE_LOCAL | created_at (criação local); updated_at (última alteração) — NÃO é data de negociação nem data ERP |
| Valor | AVAILABLE_FORCE_BACKEND (estimated_total, após sync) / AVAILABLE_LOCAL (estimado pelo domain a partir dos itens + snapshot de preço) | |
| Status local / sync | AVAILABLE_LOCAL | status (7 valores, derivados do outbox) |
| Status comercial | NOT_AVAILABLE | OrderStatus do servidor não é espelhado no aparelho |
| Tipo documental | BLOCKED_BY_ERP_MIRROR (Orçamento, Pedido ERP, Nota) | sem espelho ERP de vendas; só "Pedido Force" |
| Empresa / TOP | NOT_AVAILABLE | não guardados no rascunho |
| Negociação | AVAILABLE_LOCAL | negotiation_type_code (código; nome não guardado) |
| Vendedor | AVAILABLE_LOCAL (owner_account_id) | sempre o próprio |
| Qtd itens | AVAILABLE_LOCAL | count(local_order_item) |
| clientRequestId | AVAILABLE_LOCAL | client_request_id |
| Última atualização | AVAILABLE_LOCAL | updated_at |

## Status → agrupamento
- NÃO ENVIADOS: local_only, pending_sync, syncing, sync_error, conflict, needs_review
- ENVIADOS ("Sincronizado com o Force", NÃO é ERP): synced
- Sincronizado com edição pendente volta a pending_sync → aparece em Não enviados (alterações ainda não enviadas).

## Dívida registrada (não alterada)
`PRICE_DISPLAY_PRECISION`: `formatBrl` preserva casas significativas (ex.: "R$ 982,5215"). Comportamento pré-existente, não tocado no M5.
