# Fluxo "Confirmar" do pedido (mobile)

Status: implementado, build-only (testes e verificação em aparelho pendentes).

## Fluxo

1. O fim do pedido tem DOIS botões (decisão do dono, 2026-11-23):
   - "Confirmar" (primário): conclui o pedido e tenta criá-lo no Sankhya agora. Depois de confirmado o app BLOQUEIA a edição.
   - "Salvar e sair" (secundário): salva e sai. O pedido fica SÓ no aparelho, não vai ao Sankhya (nunca chama `confirm` nem grava pedido de envio) e continua editável. O "X" do cabeçalho e o Voltar do Android fazem exatamente isto, sem pergunta; pedido vazio (sem cliente e sem itens) não grava nada.
   - Não existem "Salvar rascunho", "Salvar pedido" nem "Salvar orçamento". Vale para pedido (TOP 1001) e orçamento (TOP 1000).
2. Confirmar grava localmente (pedido + pedido de envio, `sendState = requested`) e chama `SyncManager.confirmOrder`.
3. `confirmOrder` empurra a outbox (até 2 rodadas, só com internet) dentro de `CONFIRM_WAIT_MS` (8 s) e lê o resultado do rascunho:
   - `sent`: o Sankhya já devolveu o número (`erpNumber`); a tela mostra "Pedido enviado" e "Nº ...".
   - `sending`: aceito pelo servidor, número ainda não disponível ("Enviando ao Sankhya"; o status segue pelo acompanhamento de estágio).
   - `awaiting_approval`: submetido, aguarda aprovação de desconto.
   - `queued`: sem conexão ou falha transitória; fica salvo, popup `order_queued`, reenvio automático.
   - `refused`: recusa definitiva; popup com ação de correção, pedido volta a ser editável ("Precisa de correção").
   - Sankhya fora do ar (503/500/429): fica em fila, popup padrão "Sankhya indisponível" com "Tentar de novo"; nunca "Erro ao sincronizar" e nunca destrava a edição.
4. Aba Vendas mostra contador (`awaitingOrders` = envios pedidos + recusados, isto é, "Aguardando envio" + "Precisa de correção").

## Estados do pedido

| Estado (selo) | Editável | Observação |
|---|---|---|
| Salvo no aparelho | sim | Substitui "Em andamento" e "Somente no aparelho". Toque na lista abre o assistente no Resumo, preenchido. |
| Aguardando envio | NÃO | Confirmado e na fila; reenvio automático (rede, login, "Sincronizar agora"). Abre somente leitura. |
| Enviado ao Sankhya | não | Com número único. Somente leitura. |
| Precisa de correção | sim | Confirmado e recusado com erro DEFINITIVO; motivo e ação no popup padrão; o vendedor corrige e confirma de novo. |

Erros transitórios (rede, Sankhya fora do ar, tempo esgotado) nunca destravam: o pedido continua na fila e é reenviado.

## Cópia no servidor de um pedido só salvo

O app sincroniza pedidos não confirmados com o Force por `POST /orders` como rascunho (comandos `order.create/replace`). No servidor, `enqueueForErp` só é chamado no submit (`orders.service`), portanto essa cópia nunca chega ao Sankhya. O selo continua "Salvo no aparelho" mesmo depois de sincronizar, e o pedido segue em "Não enviados". Pendência para o dono: manter essa cópia no Force ou torná-lo estritamente local.

## Voltar do Android e abas

- Ordem do Voltar (função pura `resolveBack`, `ui/back-navigation.ts`): modal/popup/sobreposição, assistente (um passo atrás; no passo 1 "Salvar e sair"), tela interna (ficha de cliente, detalhe de venda), raiz de aba vai ao Início. No Início, o primeiro toque mostra "Toque de novo para sair" e um segundo toque em até 2 s fecha o app. Na tela de sincronização o Voltar é ignorado.
- Ao sair de uma aba ela volta à tela inicial (Clientes, Vendas, Catálogo, Perfil). Trocar de aba salva o pedido aberto ("Salvo no aparelho") e o fecha; pedido vazio não grava nada.
- A tela inicial de Vendas é "Minhas vendas" (Não enviados / Enviados) com o botão "Nova venda". Toque em "Salvo no aparelho" ou "Precisa de correção" abre o assistente no Resumo; os demais abrem o detalhe somente leitura (toque longo sempre abre o detalhe: excluir, duplicar, PDF).

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
