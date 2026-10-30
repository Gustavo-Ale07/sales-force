# SNK-7 — Roteiro do dry-run e do teste #1 no Sandbox (D-10)

Status: PREPARADO, NÃO EXECUTÁVEL. Nada deste documento pode rodar sem o "AUTORIZO" escrito do dono, depois de revisar o dry-run (D-10). Nenhuma etapa foi executada; nenhuma chamada ao Sankhya foi feita ao preparar este roteiro (SNK-3, SNK-6).

Decisões: SNK-7 D-1..D-10 (`docs/decisions.md` §3.16), SNK-4 (idempotência), SNK-5 (campo de origem dedicado), SNK-6 (comporta de escrita), SNK-3 (produção nunca é tocada). Fatos e pendências do Sankhya: `docs/sankhya-spike.md` §9.38.

## 1. Pré-condições (todas do dono; nada aqui é feito pelo agente)

1. Credenciais do spike rotacionadas (SEC-1); nenhuma credencial entra em Git, em compose ou neste documento.
2. Campo de origem dedicado criado no Sandbox (coluna `AD_...` em TGFCAB, nunca `AD_VDYORIG`/`AD_NUVIDYA`, SNK-5). O nome entra só em `SANKHYA_ORDER_ORIGIN_FIELD` do worker.
3. Confirmados no Sandbox (hoje NEEDS VALIDATION): forma do `confirmarNota`; corpo de erro do `incluirNota`; valor de `IGNOREDESCPROMOQTD`; lista de vários itens; `PERCDESC` com `INFORMARPRECO` falso; colunas relidas de TGFITE; `CODLOCALORIG` 209.
4. Dry-run revisado pelo dono (seção 2) e "AUTORIZO" escrito, citando este documento e o orçamento (seção 4).
5. Host: somente `placfestas-teste.sankhyacloud.com.br` ou `api.sandbox.sankhya.com.br` (lista fixa no código). Produção, staging e CI nunca.

## 2. Fase 1 — dry-run (sem rede para o Sankhya)

O worker, com a chave de escrita em modo `dry_run`, monta a requisição de cada pedido enfileirado e a grava em `integration_order_dry_run` (D-6): apenas códigos, UUIDs, quantidades e valores; `OBSERVACAO` substituída pelo hash; sem token, nome, CPF/CNPJ; retida 30 dias e removida pelo job `integration.order.dry-run-purge`. Nenhum pedido é enviado e nenhum token é pedido.

O dono revisa as duas requisições (pedidos A e B abaixo) contra o contrato de `incluirNota` e aprova ou pede ajuste.

## 3. Fase 2 — teste #1 (somente após "AUTORIZO" escrito)

Pedido A: 1 item, sem desconto, TOP 1001, condição à vista (negociação 11).
Pedido B: 1 item com 8 % de `PERCDESC`, TOP 1001, negociação 2.

Sequência:

1. `incluirNota` do pedido A, depois `confirmarNota` (dois passos idempotentes, D-4). Reler a nota (D-7): confere itens, quantidades, valores e o campo de origem = UUID do pedido.
2. `incluirNota` e `confirmarNota` do pedido B. Reler e conferir o desconto de 8 %.
3. Reenvio do pedido A (mesma chave de idempotência): o worker consulta primeiro a origem (`findOrderByOrigin`), encontra a nota e apenas a vincula. Critério de aprovação: nenhuma segunda nota criada (SNK-4).
4. Limpeza: `excluirNotas` das notas criadas; se recusado, `cancelarNota` como alternativa. Registrar o resultado em `docs/sankhya-spike.md`.

Interrupção imediata (sem nova tentativa) em: erro de autenticação, resposta fora do contrato, qualquer segunda nota para o mesmo UUID, ou uso do orçamento.

## 4. Orçamento

No máximo 40 requisições ao Sandbox em todo o teste (token, consultas de origem, inclusões, confirmações, releituras, limpeza). O worker não deve ultrapassar; ao chegar a 40 o teste termina e o dono decide.

## 5. Seção do dono — comando que HABILITARIA a escrita no Sandbox (DESATIVADO)

Não executar. Registrado apenas para que o dono saiba o que seria alterado, depois do "AUTORIZO". As variáveis são do worker (a API nunca recebe credenciais do Sankhya, STACK-2); os valores sensíveis vêm do cofre do dono, não deste repositório.

```
# DESATIVADO — exige "AUTORIZO" escrito do dono (D-10)
SANKHYA_ORDER_WRITE_ENABLED=true
SANKHYA_ORDER_WRITE_MODE=live
SANKHYA_ORDER_WRITE_GATES_CLOSED=1
SANKHYA_ORDER_ORIGIN_FIELD=<coluna AD_ criada no Sandbox>
SANKHYA_ENVIRONMENT=sandbox
SANKHYA_MODE=live
SANKHYA_BASE_URL=<um dos dois hosts do Sandbox>
```

Do lado da API, o enfileiramento (`ERP_ORDER_ENQUEUE_ENABLED=true`) só é aceito fora de produção. Todos os padrões distribuídos (compose de desenvolvimento e staging) mantêm os dois desligados; um teste automatizado falha se algum arquivo de deploy habilitar a escrita.

Antes de ligar: o worker recusa iniciar em modo `live` fora do Sandbox, sem a marca de comportas fechadas ou sem o campo de origem. Para voltar: remover as variáveis (ou `SANKHYA_ORDER_WRITE_ENABLED=false`); o agendamento é retirado na próxima partida do worker.
