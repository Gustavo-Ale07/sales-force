# WEB_PARITY (trabalho, não commitar)

Auditoria de paridade da web (`apps/web`) com o fluxo operacional real da PLAC (referência funcional: Vidya Force; `VIDYA_PARITY_MATRIX.md`). Data: 2026-10-01. Só endpoints existentes; `apps/server` e contracts intocados.

Classes: REQUIRED (necessário para o fluxo diário, sem Sankhya) · P1 (próxima onda) · NOT_NEEDED (fora do uso PLAC/escopo) · BLOCKED_SANKHYA (depende de dado/escrita Sankhya ainda não validado).
Estado: IMPLEMENTED (esta rodada) · OPEN.

| # | Lacuna | Classe | Estado | Notas |
|---|---|---|---|---|
| 1 | Duplicar pedido | REQUIRED | IMPLEMENTED | Botão "Duplicar pedido" no cabeçalho do pedido (qualquer situação). `POST /orders` com produto + quantidade + tipo de negociação; preço recalculado pelo servidor; desconto e observações NÃO são copiados (autoridade de desconto P-10 UNDECIDED R35/R36). Recusa por produto indisponível lista os itens e oferece "Duplicar sem esses itens". Idempotência: mesmo `clientRequestId` após resposta perdida. Desabilitado com edições não salvas. |
| 2 | Perfil do usuário | REQUIRED | IMPLEMENTED (somente leitura) | `/perfil` ("Meu perfil" no menu do usuário): nome, e-mail, perfil de acesso, vendedores vinculados, a partir de `GET /auth/session`. Troca de senha/edição: ver "Endpoints ausentes". |
| 3 | Recarregar dados explicitamente | REQUIRED | IMPLEMENTED (reload do cache web) | Menu do usuário, "Atualizar dados": invalida/refaz todas as consultas ativas e marca o resto como obsoleto; confirma ou informa falha. Relê o Sales Force; NÃO dispara sincronização com o ERP (não há endpoint). Dataset congelado de uma tela de pedido só muda recarregando a página (mantido de propósito: 409 `dataset_mismatch` já orienta isso). |
| 4 | Textos de situação do pedido | REQUIRED | IMPLEMENTED | `draft` Rascunho · `cancelled` Descartado · `queued` Na fila de envio ao ERP · `sent` Enviado ao ERP (tom info, nunca success; dica: não indica confirmação nem faturamento) · `rejected` Rejeitado no envio ao ERP · `unknown` Situação desconhecida. Nenhum texto "faturado/sincronizado/confirmado". |
| 5 | Rascunho que requer revisão (cliente inelegível) | REQUIRED | IMPLEMENTED | Campo derivado `review` do contrato (outro agente): selo "Requer revisão" na lista, alerta no editor com o motivo (indisponível, inativo, bloqueado, sem vendedor), "Enviar ao ERP" desabilitado; o status do pedido continua o mesmo. |
| 6 | "Sem preço" | REQUIRED | JÁ EXISTIA | `NO_PRICE_TEXT`/`PriceCell`; duplicar não fabrica preço (servidor decide). |
| 7 | Repetir último pedido / pedidos recorrentes (modelos) | REQUIRED | JÁ EXISTIA | Ficha do cliente. |
| 8 | Novo pedido, carrinho, lançamento múltiplo, descontos por grupo/massa, filtros de lista de pedidos | REQUIRED | JÁ EXISTIA | |
| 9 | Ação "Duplicar" na linha da lista de pedidos | P1 | OPEN | Hoje só no detalhe do pedido; reaproveitar `DuplicateOrderButton`. |
| 10 | Imprimir / compartilhar pedido (PDF) | P1 | OPEN | Sem endpoint; exigiria definir layout e regras de dados (nunca custo/margem). |
| 11 | Histórico de vendas do cliente (por produto) | P1 | OPEN (PENDING_VALIDATION no Vidya) | Só histórico do Sales Force é possível hoje; ERP não espelhado. |
| 12 | Situação do pedido no ERP (status Vidya 0-6 / faturamento) | BLOCKED_SANKHYA | OPEN | API não carrega status ERP; envio ao ERP desabilitado (SNK-6). Não exibir "faturado". |
| 13 | Enviar pedido ao ERP, cancelar pedido enviado | BLOCKED_SANKHYA | BLOQUEADO | Gates de escrita V-11/V-13. O botão existe e responde `erp_submission_disabled`. |
| 14 | Financeiro / limite de crédito / títulos do cliente | BLOCKED_SANKHYA | OPEN | Regras EXIBLIMCRECAR/BLOQVENDPPRAZO a validar. |
| 15 | Disparar sincronização do ERP agora | BLOCKED_SANKHYA | OPEN | Sem endpoint e escrita/leitura real não liberada; a tela Integração só informa o estado. |
| 16 | Promoções, bloqueio por unidade | NOT_NEEDED | n/a | 0 linhas / NULL no TESTE. |
| 17 | Estoque (consulta/bloqueio), rota, GPS, pesquisa, foto PDV | NOT_NEEDED | n/a | Fora do escopo (P-13). |
| 18 | Agenda, Mural, Engajamento, Performance, Relatórios Vidya | NOT_NEEDED por ora | n/a | Futuro; não implementar (matriz). |
| 19 | Notificações | NOT_NEEDED | n/a | Sino sem fonte; sem endpoint. |
| 20 | Exportação de pedidos/clientes | NOT_NEEDED | n/a | Não adicionar sem permissão explícita (P-20). |

## Endpoints ausentes (lista, nada inventado)
1. `POST /orders/{id}/duplicate` (opcional): duplicação atômica no servidor com `skippedLines` como em `repeat-last`/templates, sem a ida e volta de "Duplicar sem esses itens". A web funciona sem ele via `POST /orders`.
2. Alteração de senha / dados da conta (`PATCH /auth/me`, `POST /auth/password`): hoje o perfil é só leitura; depende de AUTH-x (PROPOSED) e das regras de senha (P-11).
3. Sessão: `GET /auth/session` devolve `expiresAt`, mas a UI (`AuthUser`) ainda não o expõe; só falta mapear no cliente, sem endpoint novo.
4. Carimbo de "última atualização do dataset" por tela e disparo de sincronização com o ERP: não existem; `GET /integration` cobre só o estado para perfis de integração.
5. Status ERP e faturamento no DTO do pedido: ausente (aguarda SNK-6 e a derivação GETCODSTATUS_VIDYA).

## Observações
- Contrato: `OrderListItem.review` foi adicionado por outro agente em paralelo; o fixture da web (`test/fixtures.ts`) foi ajustado (`review: null`) para o typecheck voltar a passar.
- O comentário do contrato diz que `sent` = "ERP aceitou"; por isso o texto é "Enviado ao ERP" com dica explícita de que não é faturamento.
- Verificação em navegador (Playwright) NÃO foi feita nesta rodada: só testes de componente/rota com `fetch` simulado.
