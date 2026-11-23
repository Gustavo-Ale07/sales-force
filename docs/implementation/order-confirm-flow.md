# Fluxo "Confirmar" do pedido (mobile)

Status: implementado, build-only (testes e verificação em aparelho pendentes).

## Fluxo

1. "Confirmar" é o único botão de conclusão (resumo do pedido e detalhe da venda). Não existe mais Enviar/Salvar.
2. Confirmar grava localmente (pedido + pedido de envio, `sendState = requested`) e chama `SyncManager.confirmOrder`.
3. `confirmOrder` empurra a outbox (até 2 rodadas, só com internet) dentro de `CONFIRM_WAIT_MS` (8 s) e lê o resultado do rascunho:
   - `sent`: o Sankhya já devolveu o número (`erpNumber`); a tela mostra "Pedido enviado" e "Nº ...".
   - `sending`: aceito pelo servidor, número ainda não disponível ("Enviando ao Sankhya"; o status segue pelo acompanhamento de estágio).
   - `awaiting_approval`: submetido, aguarda aprovação de desconto.
   - `queued`: sem conexão ou falha transitória; fica salvo, popup `order_queued`, reenvio automático.
   - `refused`: recusa definitiva; popup com ação de correção, pedido continua editável.
4. Aba Vendas mostra contador (`awaitingOrders` = envios pedidos + recusados).

## Como o número chega (2.2)

Sem mudança de servidor/contrato. O submit é aceito e enfileirado; o worker grava a nota no Sankhya depois. O app consulta `GET /orders?ids=<id>` (`fetchOrderStatuses`, via `refreshOneOrderErpStatus`) a cada `CONFIRM_POLL_MS` (1,5 s) até vir `erpNumber` ou acabar a janela de 8 s. Se não vier, o estado é `sending` e a atualização normal de status completa depois.

## Idempotência

- Origem do pedido = id do pedido; reenvio do submit é idempotente no servidor.
- `saveOrderDraft` com `sendRequested` e payload idêntico ao último comando não cria novo comando nem linha de outbox.
- Duplo toque: guarda síncrona (`confirmingRef`) nas duas telas.

## Classificação de erros de envio (`SUBMIT_FAILURE_CLASS`, `offline/transport.ts`)

| Classe | Motivos | Comportamento |
|---|---|---|
| Transitória | network, auth, rate_limit, server | Fica em fila; reenvio automático com backoff; sem popup de erro (só `order_queued`) |
| Definitiva | erp_submission_disabled, discount_blocked, customer_without_seller, customer_ineligible, customer_inactive, customer_blocked, customer_pending, version_conflict, order_not_editable, dataset_mismatch, edit_before_resubmitting, needs_manager_approval, approval_required_before_resend, invalid_status, legacy_dataset, dataset_not_erp, environment_unbound, environment_mismatch, delivery_diverged, ambiguous_origin, header_not_eligible, validation_failed, not_found, forbidden, send_refused | Sem laço de reenvio; popup com ação (trocar cliente, remover item, revisar itens/condições); pedido editável; "Tentar de novo" após corrigir |
| Desconhecida | qualquer outro motivo | Tratada como definitiva |

## Nota 2.7

Regras de edição após envio seguem as da web; o app não permite editar pedido enviado/enviando.

## Verificar só em aparelho

Overlay "Enviando ao Sankhya", espera e polling reais contra o worker, comportamento offline/reconexão.
