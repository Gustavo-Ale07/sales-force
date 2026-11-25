# Aceitação da sincronização contra o Sandbox Sankhya (RT-1)

Roteiro do dono (item 4, 2026-11-25) e rastreio dos testes. Só **Sandbox** (SNK-3): nunca produção. Dados sintéticos; nenhum valor real neste arquivo.
Base: `decisions.md` RT-1 (online em tempo real; exclusão só após leitura bem-sucedida sem a nota, mass-guard, restauração) e `sankhya-spike.md`.

**Legenda.** AUTOMATIZADO = cobertura com o gateway fake (nome do arquivo e teste). ROTEIRO = o dono executa no Sandbox. Colunas validadas = as já usadas pelo gateway real (`packages/sankhya/src/real`); **[NÃO VALIDADA]** marca coluna ainda sem validação (NEEDS VALIDATION, `sankhya-spike.md` §9.53/§9.61). O SELECT do Sankhya é Oracle; `:x` = valor que o dono troca.

Arquivos de teste: **M** = `apps/server/test/integration/sync-acceptance-mirror.test.ts` · **O** = `.../sync-acceptance-orders.test.ts` · **S** = `.../order-erp-status.test.ts` · **R** = `.../orders-realtime.test.ts` · **D** = `.../order-delivery.test.ts`.

## Pedidos

| # | Cenário | Passos | Esperado no app e no site | SELECT Sankhya (prova) | SELECT Force (prova) | Marca |
|---|---|---|---|---|---|---|
| A1 | Criar pedido | Criar e confirmar o pedido no app (ou no site). Aguardar o worker (segundos). | Pedido some de "rascunho/na fila", aparece "Enviado" com o NUNOTA, nos dois lados. | `SELECT NUNOTA, STATUSNOTA, AD_FORCEORIGEM FROM TGFCAB WHERE AD_FORCEORIGEM = ':id_pedido'`; itens: `SELECT NUNOTA, CODPROD, QTDNEG, VLRUNIT FROM TGFITE WHERE NUNOTA = :nunota` (QTDNEG/VLRUNIT **[NÃO VALIDADA]** neste roteiro: conferir antes) | `SELECT status, erp_number, external_origin_id FROM sales_order WHERE id = ':id_pedido'` e `SELECT status FROM integration_outbox WHERE aggregate_id = ':id_pedido'` (esperado `sent` / `confirmed`) | ROTEIRO (entrega: AUTOMATIZADO D "live delivery") |
| A2 | Editar pedido | Editar o pedido enviado (quando o status permitir) ou editar um rascunho e reenviar. | Valores novos nos dois lados; um único pedido. | idem A1; contar: `SELECT COUNT(*) FROM TGFCAB WHERE AD_FORCEORIGEM = ':id_pedido'` = 1 | `SELECT erp_number, updated_at FROM sales_order WHERE id = ':id_pedido'` | ROTEIRO |
| A3 | Excluir pedido no Sankhya + "Sincronizar agora" | No Sankhya excluir a nota (Sandbox). No app e no site tocar "Sincronizar agora" (ou esperar o ciclo de 30 s). | A nota some das listas e do detalhe nos dois lados; nunca "Precisa de correção". Pedido com trabalho local não enviado (rascunho, na fila) permanece. Se o NUNOTA voltar, o pedido volta. | `SELECT COUNT(*) FROM TGFCAB WHERE NUNOTA = :nunota` = 0 | `SELECT erp_removed_at, erp_missing_checks FROM sales_order WHERE id = ':id'` (preenchido); `SELECT action, at FROM audit_log WHERE action IN ('order.erp_removed','order.erp_restored') ORDER BY at` | AUTOMATIZADO: O "A3 ... one confirmed absence ... restores"; O "mass-absence guard ... manual refresh"; O "read failure ... manual refresh"; S "RT-1 deleted-order detection"; R "'Sincronizar agora' alone removes"; `unit/order-removal.test.ts`. Roteiro: confirmar visualmente app e site |
| A4 | Reenviar pedido (sem duplicar) | No site/app usar "Reenviar" no pedido já enviado, várias vezes. | Continua um pedido com o mesmo NUNOTA. Nenhum segundo pedido no Sankhya. | `SELECT COUNT(*) FROM TGFCAB WHERE AD_FORCEORIGEM = ':id_pedido'` **= 1** | `SELECT COUNT(*) FROM integration_outbox WHERE aggregate_id = ':id_pedido'` = 1; `SELECT erp_number FROM sales_order WHERE id = ':id_pedido'` inalterado | AUTOMATIZADO: O "A4 three resends in a row"; D "M1 SNK-4 same outbox row", "an include whose answer was lost is found by origin", "two sweeps at once". Roteiro (Sandbox real): repetir com `AD_FORCEORIGEM` criado no Sandbox |
| A5 | Pedido liberado e pedido barrado | No Sankhya liberar uma nota pendente (TSILIB) e barrar outra (reprovar). Medir o tempo até mudar no app e no site. | Liberado: estado "liberado". Barrado: "negado/barrado". Em até ~30 s (RT-1) sem apertar nada. | `SELECT NUCHAVE, EVENTO, DHLIB, REPROVADO, VLRLIBERADO FROM TSILIB WHERE TABELA = 'TGFCAB' AND NUCHAVE = :nunota`; cabeçalho `SELECT STATUSNOTA, PENDENTE FROM TGFCAB WHERE NUNOTA = :nunota` (`AD_STATUS` **[NÃO VALIDADA]** no Sandbox, §9.53) | `SELECT release_state, stage, checked_at FROM sales_order_erp_stage WHERE nunota = :nunota`; `SELECT erp_status_detail, erp_status_checked_at FROM sales_order WHERE erp_number = :nunota` | AUTOMATIZADO (leitura/mapeamento): S "awaiting, released and denied", "moves from awaiting to released". ROTEIRO: o "em segundos" real (relógio do Sandbox) |

## Clientes

| # | Cenário | Passos | Esperado | SELECT Sankhya | SELECT Force | Marca |
|---|---|---|---|---|---|---|
| C1 | Cliente novo e cliente editado | Cadastrar cliente no app/site; depois editar telefone/e-mail. Em outro teste, editar o parceiro direto no Sankhya (nome). | Novo: aparece no Sankhya e volta ao app e ao site com o código. Editado no Sankhya: o nome novo chega em até 5 min (ciclo de clientes). | `SELECT CODPARC, NOMEPARC, ATIVO, BLOQUEAR, CODVEND, CODTAB FROM TGFPAR WHERE CLIENTE = 'S' AND CODPARC = :codparc` | `SELECT status, erp_customer_code FROM customer_registration WHERE id = ':id'`; `SELECT code, name, seller_code, deleted_at FROM erp_customer WHERE code = :codparc` | AUTOMATIZADO (entrega/atualização): `unit/customer-delivery-service.test.ts`, `unit/customer-update-delivery-service.test.ts`; espelho: M "customers" (update na mesma sync). ROTEIRO: ida e volta no Sandbox |
| C2 | Cliente muda de vendedor | No Sankhya trocar `TGFPAR.CODVEND` de 103 para 104. Aguardar o ciclo de clientes (5 min) ou "Sincronizar agora". | Sai do app/site do vendedor antigo; entra no do novo. | `SELECT CODPARC, CODVEND FROM TGFPAR WHERE CODPARC = :codparc` | `SELECT code, seller_code FROM erp_customer WHERE code = :codparc AND deleted_at IS NULL` | AUTOMATIZADO: M "customers ... changed seller" (a linha passa ao vendedor novo na mesma sync). A restrição por vendedor na API é coberta por `seller-privacy.test.ts`. ROTEIRO: ver nos dois clientes |
| C3 | Cliente inativado / deixa de ser cliente | No Sankhya `ATIVO = 'N'` (ou `CLIENTE = 'N'`). | Some das listas na mesma sync (linha mantida, `deleted_at`); volta se reativado. | `SELECT CODPARC, ATIVO, CLIENTE FROM TGFPAR WHERE CODPARC = :codparc` | `SELECT code, deleted_at FROM erp_customer WHERE code = :codparc` | AUTOMATIZADO: M "customers ... inactive, lost CLIENTE flag" |

## Catálogo

| # | Cenário | Passos | Esperado | SELECT Sankhya | SELECT Force | Marca |
|---|---|---|---|---|---|---|
| P1 | Produto perde a mobilidade, é inativado ou deixa de ser vendável | No Sankhya `TGFPRO.AD_MOBILIDADE = 'N'` (ou `ATIVO = 'N'`, ou `USOPROD` fora da lista). Aguardar o ciclo de produtos (10 min) ou "Sincronizar agora". | Some do catálogo do app e do site. Se a mobilidade esvaziar o catálogo inteiro, o catálogo anterior é mantido (guarda, log, sem tela). | `SELECT CODPROD, ATIVO, USOPROD, AD_MOBILIDADE FROM TGFPRO WHERE CODPROD = :codprod` | `SELECT code, active, usage_code, deleted_at FROM erp_product WHERE code = :codprod` | AUTOMATIZADO: M "products ... lost AD_MOBILIDADE, inactive and usage"; M "mobility guard"; `sync-refresh-mobility.test.ts`; `order-send-mobility.test.ts` |
| P2 | Produto perde o preço ("Sem preço") | Apagar a linha do produto em `TGFEXC` da tabela vigente. Aguardar o ciclo de preços (5 min). | O produto continua visível mas "Sem preço" (nunca R$ 0); não entra em pedido. | `SELECT NUTAB, CODPROD, VLRVENDA FROM TGFEXC WHERE NUTAB = :nutab AND CODPROD = :codprod` (0 linhas); versão: `SELECT NUTAB, CODTAB, TO_CHAR(DTVIGOR,'YYYY-MM-DD') FROM TGFTAB WHERE CODTAB = :codtab` | `SELECT version_id, product_code, unit_price, deleted_at FROM erp_list_price WHERE product_code = :codprod` (`deleted_at` preenchido) | AUTOMATIZADO: M "prices ... loses its TGFEXC price row"; `price-table-prices.test.ts`, `product-price-rule.test.ts`. ROTEIRO: confirmar o texto "Sem preço" no app e no site |
| P3 | Tabela de preços sai do escopo | Remover a `CODTAB` da lista de tabelas móveis (configuração). | Preços dessa tabela saem na mesma sync. | `SELECT NUTAB, CODTAB FROM TGFTAB WHERE CODTAB = :codtab` | `SELECT count(*) FROM erp_list_price l JOIN erp_price_table_version v ON v.version_id = l.version_id WHERE v.table_code = :codtab AND l.deleted_at IS NULL` = 0 | AUTOMATIZADO: M "prices ... table leaving the scope" |

## Offline

| # | Cenário | Passos | Esperado | SELECT Sankhya | SELECT Force | Marca |
|---|---|---|---|---|---|---|
| F1 | Offline com pedido salvo e reconexão | App em modo avião: criar e confirmar pedido (fica salvo no aparelho). Reconectar. Não tocar em nada. | Enviado uma única vez; o status se atualiza sozinho (enviado, liberado...). Nenhuma duplicata. | `SELECT COUNT(*) FROM TGFCAB WHERE AD_FORCEORIGEM = ':id_pedido'` = 1 | `SELECT status, erp_number FROM sales_order WHERE id = ':id_pedido'`; `SELECT COUNT(*) FROM integration_outbox WHERE aggregate_id = ':id_pedido'` = 1 | AUTOMATIZADO no servidor (reenvio do mesmo pedido idempotente por `client_request_id` e origem): `order-enqueue.test.ts` "replays idempotently", O "A4". ROTEIRO: o fluxo offline do aparelho (Maestro cobre só se R48 definir plataforma) |

## Resultado da execução (2026-11-25)

`pnpm`/`vitest` no `apps/server`: `sync-acceptance-mirror.test.ts` 4 passaram; `sync-acceptance-orders.test.ts` 4 passaram (Testcontainers/PostgreSQL, gateway fake).

## Lacunas

- Tempo "em segundos" e consistência com o relógio do Sandbox só se provam no roteiro (A5, C1).
- A1/A2: colunas `TGFITE.QTDNEG`/`VLRUNIT` e `TGFCAB.AD_STATUS` não validadas neste documento; validar antes de usar como prova.
- Edição de pedido já enviado (A2) depende da regra de status do dono; não coberta por teste novo.
- F1: o lado do aparelho (fila local) exige teste do mobile/Maestro, fora desta entrega.
