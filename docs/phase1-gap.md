# Lacunas da Fase 1 (auditoria somente leitura)

Data: 2026-11-26. Branch `feat/sales-force-evolution`. Auditoria por busca no codigo (sem execucao); itens marcados "verificar" nao foram abertos linha a linha.

Legenda: **FEITO** = implementado e com prova no codigo · **PARCIAL** = existe parte · **FALTA** = nao encontrado · **SUBSTITUIDO** = tela trocada por decisao do dono (aprovacao de desconto e de credito sao do Sankhya; cliente novo entra ativo sem fila).

Decisoes do dono consideradas (nao reabertas): Sankhya e a fonte de verdade; aprovacao de desconto/credito e do Sankhya; cliente novo entra ativo; limite de desconto por vendedor em 4 niveis (geral, grupo pai, grupo filho, produto) cadastrado no site.

## Requisitos F1

| ID | Resumo | Status | Prova / lacuna |
|---|---|---|---|
| IAM-7 | Registro e revogacao de aparelhos; app apaga banco local | PARCIAL | Wipe local em `apps/mobile/src/offline/services.ts` (`wipeAll`), sessoes em `packages/db/src/schema/iam.ts`. Falta tabela/registro de aparelho, revogacao por aparelho e tela admin. |
| IAM-8 | Bloqueio apos 7 dias sem sincronizar | FALTA | Nenhum limite offline em `apps/mobile/src` nem no servidor. |
| CAT-4 | Custo/margem nunca chegam ao app/PJ | FEITO | Contratos sem custo (`packages/contracts/src/catalog.ts`); guarda em `apps/server/src/platform/dataset-guard.ts`. |
| ACC-2 | Ficha do cliente | PARCIAL | `apps/web/src/components/customer-ficha.tsx`, `apps/mobile/src/ui/customer-detail-screen.tsx`, `GET /customers/{code}/financial`. Abas "Analise do cliente"/"Engajamento" sao placeholders (parity-matrix). |
| ACC-3 | Cadastro de cliente (inclusive offline) | FEITO | `apps/server/src/customers/customer-registration.service.ts`, `apps/web/src/components/customer-create-dialog.tsx`, `apps/mobile/src/ui/customer-create-screen.tsx` (3 telas, CEP automatico). |
| CON-1 | Contatos vinculados a conta | FALTA | Sem entidade/tabela de contatos em `packages/db/src/schema`; so campos de contato no cadastro. |
| CON-2 | Contatos do Sankhya espelhados; criados no Force ficam locais | FALTA | Sem espelho de contatos em `apps/server/src/mirror`. |
| ORD-6 | Revisao de preco item a item | PARCIAL | Estado `price_review` no mobile (`packages/mobile-db/src/order-sync.ts`, `apps/mobile/src/ui/sale-detail-screen.tsx`). Falta tela web e fluxo de resolucao no servidor (conferir com regra "Sankhya decide"). |
| ORD-8 | Repetir/duplicar pedido | FEITO | `apps/web/src/components/duplicate-order-button.tsx`, `order-templates-card.tsx`; app em `apps/mobile/src/ui/order-templates-section.tsx`. |
| ORD-9 | Importar pedido do cliente por planilha | PARCIAL | So lancamento multiplo/arquivo de itens: `apps/web/src/components/bulk-entry-dialog.tsx`, `apps/web/src/lib/entry-file.ts`, `apps/mobile/src/ui/bulk-entry-screen.tsx`. Falta assistente em etapas com mapeamento e erros por linha. |
| ORD-10 | PDF/compartilhar orcamento | FEITO | `apps/mobile/src/offline/order-pdf.ts`, `order-pdf-expo.ts`; web `apps/web/src/components/print-order-button.tsx`. |
| ACT-1 | Tarefas | FALTA | Sem tarefas em db/server/web/mobile. |
| ACT-2 | Tarefas offline | FALTA | Depende de ACT-1. |
| ACT-3 | Lembretes push e web | FALTA | Sem push nem lembretes. |
| GOL-1 | Metas e realizado | FALTA | Grupo `goals` nao implementado; `apps/server/src/dashboard/dashboard.service.ts` so tem indicadores basicos. |
| GOL-2 | Positivacao | PARCIAL | `positivation_rate` em `dashboard.service.ts`/`packages/contracts/src/dashboard.ts`; regra marcada UNDECIDED, sem tela dedicada. |
| GOL-3 | Comissoes | FALTA | Campo de comissao so no espelho (`packages/db/src/schema/mirror.ts`, `packages/sankhya/src/sales-history.ts`); sem endpoint nem tela. |
| IMP-1 | Upload xlsx/csv (20 MB/50 mil linhas) | PARCIAL | Leitura de arquivo so para itens de pedido (`apps/web/src/lib/entry-file.ts`); sem upload geral nem limites. |
| IMP-2 | Assistente em etapas | FALTA | Nao existe. |
| IMP-3 | Tipos de importacao | FALTA | Nao existe (so itens de pedido). |
| IMP-5 | PJ importa, nunca exporta | FALTA | Sem modulo de importacao/exportacao com regra por papel. |
| DSH-5 | Painel do vendedor no app | PARCIAL | `apps/mobile/src/ui/home-screen.tsx` com 5 indicadores via `GET /dashboard`. Faltam meta do mes, realizado, positivacao, pedidos com erro e tarefas do dia. |
| NOT-1 | Central de notificacoes + push | FALTA | Sem central nem push; so SSE de tempo real (`apps/server/src/events`). |
| NOT-2 | Eventos minimos | FALTA | Depende de NOT-1. |
| INT-1 | CNPJ via BrasilAPI + cache 30 dias | PARCIAL | BrasilAPI existe so para CEP (`apps/server/src/customers/postal-code.source.ts`); consulta de CNPJ e cache nao encontrados (verificar). |

## Telas web (W-05..W-39)

| ID | Nome | Status | Prova / lacuna |
|---|---|---|---|
| W-05 | Dashboard vendedor | PARCIAL | `apps/web/src/routes/dashboard.tsx`; sem metas/comissoes/tarefas. |
| W-06 | Dashboard gerente | PARCIAL | Mesma rota; sem visao de equipe. |
| W-07 | Carteira de clientes | FEITO | `apps/web/src/routes/customers.tsx`. |
| W-08 | Detalhe do cliente | PARCIAL | `apps/web/src/routes/customer-detail.tsx`; abas Analise/Engajamento placeholders. |
| W-09 | Historico de compras | FEITO | `apps/server/src/sales-history/`, `customer-ficha.tsx` (verificar tela). |
| W-10 | Titulos financeiros | PARCIAL | Endpoint `/customers/{code}/financial` entregue; exibicao na ficha web a verificar. |
| W-11 | Contatos | FALTA | Ver CON-1. |
| W-12 | Novo cliente | FEITO | `apps/web/src/components/customer-create-dialog.tsx`. |
| W-13 | Aprovacao de cliente | SUBSTITUIDO | Cliente novo entra ativo sem fila. |
| W-14 | Catalogo de produtos | FEITO | `apps/web/src/routes/products.tsx`. |
| W-15 | Produto | PARCIAL | Detalhe existe no app (`product-detail-sheet.tsx`); pagina web dedicada a verificar. |
| W-16 | Pedidos | FEITO | `apps/web/src/routes/orders.tsx`. |
| W-17 | Novo pedido | FEITO | `apps/web/src/routes/order-editor.tsx`. |
| W-18 | Editor do pedido | FEITO | `apps/web/src/routes/order-editor.tsx`. |
| W-19 | Revisao de preco | FALTA | Sem tela web (ver ORD-6). |
| W-20 | Aprovacao de desconto | SUBSTITUIDO | Aprovacao e do Sankhya. (`routes/approvals.tsx` ainda existe: revisar/retirar.) |
| W-21 | Aprovacao de credito | SUBSTITUIDO | Credito e do Sankhya. |
| W-22 | Detalhe do pedido | FEITO | `apps/web/src/routes/orders-route.tsx`, `order-stage.tsx`. |
| W-23 | Metas | FALTA | Ver GOL-1. |
| W-24 | Positivacao | PARCIAL | So indicador no dashboard. |
| W-25 | Comissoes | FALTA | Ver GOL-3. |
| W-26 | Tarefas | FALTA | Ver ACT-1. |
| W-27 | Agenda | FALTA | Ver ACT-1. |
| W-28 | Notificacoes | FALTA | Ver NOT-1. |
| W-29 | Importacoes | PARCIAL | So lancamento multiplo de itens. |
| W-30 | Erros de importacao | FALTA | Nao existe. |
| W-31 | Saude das integracoes | FEITO | `apps/web/src/routes/integration.tsx`, `components/integration-pill.tsx`. |
| W-32 | Fila de erros Sankhya | PARCIAL | `release-queue.tsx` e reenvio (`apps/server/src/ops-order-resend.ts`); tela dedicada de erros a confirmar. |
| W-33 | Usuarios | FALTA | So CLI (`apps/server/src/account-cli.ts`); sem tela. |
| W-34 | Equipes | FALTA | Sem entidade nem tela. |
| W-35 | Perfis e permissoes | FALTA | Politica no servidor (`iam/policy.ts`); sem tela. |
| W-36 | Dispositivos | FALTA | Ver IAM-7. |
| W-37 | Auditoria | PARCIAL | Tabela `audit_log` e `iam/audit.service.ts`; sem tela de consulta. |
| W-38 | Configuracoes | FEITO | `apps/web/src/routes/settings.tsx`. |
| W-39 | Limites de desconto | PARCIAL | `apps/web/src/routes/discount-limits.tsx`; precisa migrar para o modelo por vendedor em 4 niveis. |

(W-01..W-04 e W-40/W-41 ficaram fora do escopo pedido.)

## Telas mobile (M-01..M-26)

| ID | Nome | Status | Prova / lacuna |
|---|---|---|---|
| M-01 | Login | FEITO | `apps/mobile/src/ui/login-screen.tsx`. |
| M-02 | Aprovacao do aparelho | FALTA | Sem registro/aprovacao de aparelho (IAM-7). |
| M-03 | Sincronizacao inicial | FEITO | `ui/sync-progress-overlay.tsx`. |
| M-04 | Home | FEITO | `ui/home-screen.tsx` (ver DSH-5 para lacunas). |
| M-05 | Clientes | FEITO | `ui/customers-screen.tsx`. |
| M-06 | Detalhe do cliente | FEITO | `ui/customer-detail-screen.tsx`. |
| M-07 | Busca de produtos | FEITO | `ui/products-screen.tsx`, `product-browser.tsx`. |
| M-08 | Selecao de produto | FEITO | `ui/product-detail-sheet.tsx`, `product-picker.tsx`. |
| M-09 | Montagem de pedido | FEITO | `ui/new-order-screen.tsx`, `cart-view.tsx`. |
| M-10 | Resumo do pedido | FEITO | `ui/cart-view.tsx`, `order-wizard-parts.tsx`. |
| M-11 | Pedido salvo offline | FEITO | `packages/mobile-db/src/local-orders.ts`, `ui/sales-screen.tsx`. |
| M-12 | Fila de sincronizacao | FEITO | `ui/sync-status.tsx`. |
| M-13 | Revisao de preco | PARCIAL | Estado em `sale-detail-screen.tsx`; falta comparativo item a item dedicado. |
| M-14 | Resultado de aprovacao | PARCIAL | `ui/erp-stage-card.tsx` mostra etapa/nivel do Sankhya; sem tela propria (aprovacao e do Sankhya). |
| M-15 | Tarefas | FALTA | Ver ACT-2. |
| M-16 | Notificacoes | FALTA | Ver NOT-1. |
| M-17 | Status de sync | FEITO | `ui/sync-indicator.tsx`, `sync-status.tsx`. |
| M-18 | Limite offline atingido | FALTA | Ver IAM-8. |
| M-19 | Aparelho revogado | PARCIAL | Wipe existe; sem tela nem gatilho de revogacao. |
| M-20 | Atualizacao obrigatoria | FEITO | `ui/required-update-screen.tsx`, `update-gate.tsx`. |
| M-21 | Novo cliente offline | FEITO | `ui/customer-create-screen.tsx` com fila local. |
| M-22 | Pedidos | FEITO | `ui/sales-screen.tsx`, `sale-detail-screen.tsx`. |
| M-23 | Compartilhar orcamento PDF | FEITO | `offline/order-pdf.ts`, `order-pdf-expo.ts`. |
| M-24 | Metas e comissoes | FALTA | Ver GOL-1/GOL-3. |
| M-25 | Importacao no app | PARCIAL | `ui/bulk-entry-screen.tsx` (lancamento multiplo). |
| M-26 | Chave local perdida | PARCIAL | `ui/quarantine-screen.tsx` (verificar se cobre chave perdida). |

## FALTA e PARCIAL de Fase 1, em ordem de prioridade

1. IAM-7 / IAM-8 / M-02 / M-18 / M-19 / W-36: registro e revogacao de aparelho, bloqueio de 7 dias (seguranca).
2. Limite de desconto por vendedor em 4 niveis (W-39) e remocao de W-20/W-21/`approvals.tsx` conforme decisoes.
3. ORD-6 / W-19 / M-13: revisao de preco completa (web e app).
4. GOL-1/2/3, DSH-5, W-23/24/25, M-24: metas, positivacao, comissoes e painel do vendedor.
5. ACT-1/2/3, W-26/27, M-15: tarefas, agenda, lembretes.
6. NOT-1/2, W-28, M-16: central de notificacoes e push.
7. CON-1/2, W-11: contatos.
8. IMP-1/2/3/5, ORD-9, W-29/30, M-25: assistente de importacao.
9. W-33/34/35/37: usuarios, equipes, perfis, auditoria (telas admin).
10. INT-1: consulta de CNPJ com cache; ACC-2/W-08: abas Analise e Engajamento.

## Atualizacao 2026-11-27 (SRV-1): aparelhos

IAM-7, IAM-8, M-02 e o item 1 da lista de prioridade (aparelhos) passam a **FEITO** por substituicao: a aprovacao de aparelho foi removida e entrou o codigo de servidor (SRV-1, `decisions.md` §3.23). Os itens "1 aparelho por conta" e "Aparelho: wipe de revogacao" abaixo ficam obsoletos. Bloqueio de 7 dias (offline maximo) segue como esta.

## Atualizacao 2026-11-27 (staging em 838c400e, Sandbox)

Esta secao prevalece sobre as tabelas acima onde divergirem (elas sao da auditoria de 26/11).

**FEITO**
- Configuracao propria do Force (CFG-9, `decisions.md` §3.22): `force_config` e `seller_discount_rule` (migracao 0063), telas `/parametros` e `/descontos-representante` (admin/gestor).
- Limites de desconto por representante (cadeia: produto > subgrupo > grupo pai > geral do representante > `TGFPRO.DESCMAX` > sem limite) e sua tela; sync dos limites no app (`/discount-limits/mine`) e dos parametros (`/devices/me`: `offlineMaxDays`, `defaultPriceTableCode`). Substitui W-39 "4 niveis" e a leitura de `AD_FORCECFG`/`AD_FORCELIMDESC`/`TGFVEN.DESCMAX`.
- Tabela de preco no cadastro/edicao de cliente (CODTAB obrigatorio, 422 `price_table_not_found`), site e app.
- Metas (linha geral OU soma dos produtos; migracao 0061) e positivacao (via TGFVAR; migracao 0062): GOL-1 e GOL-2 no servidor.

**PENDENTE**
- Editar pedido: so Duplicar; falta servico de recalculo de totais/financeiro do Sankhya (`sankhya-spike.md` §9.67).
- Busca global no app.
- APK 0.3.0 publicado em /downloads: arquivos prontos; falta permissao de escrita em `/opt/force-staging/downloads` (pasta de root). (A flag `SF_ALLOW_LEGACY_APP_LOGIN` foi removida por SRV-1.)
- Tela `/configuracoes` ainda diz "Edite no Sankhya": contradiz CFG-9; trocar o texto.
- Revalidar a tabela de preco no worker na entrega (LOW).
- Quantidade realizada das metas retorna null.
- Painel de metas so no app (excecao declarada previa).
- 1 aparelho por conta.
- Bloqueio de desconto no servidor so audita (decisao: CFG-9).
- Aparelho: conferir se o wipe de revogacao limpa `offlineMaxDays` e a tabela padrao.
- Ainda FALTA (sem mudanca): GOL-3 comissoes, e os demais itens nao citados acima.
