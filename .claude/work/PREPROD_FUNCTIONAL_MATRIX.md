# PREPROD_FUNCTIONAL_MATRIX — 2026-10-02 (nota de trabalho, não commitar)

Base: VIDYA_PARITY_MATRIX.md (2026-09-30) reconferida contra o código em HEAD 555243a. Sem credenciais Sankhya nesta sessão e nenhuma chamada Sankhya feita: nada que dependa de Sankhya real foi promovido. Testes não foram reexecutados nesta passada (evidência = arquivo/commit citado, lido no repositório); números de espelho (5851 clientes, 1689 produtos, QA 76→1…) vêm do relato anterior e não foram reproduzidos aqui.
Colunas: FUNCIONALIDADE | VIDYA/SANKHYA | WEB | MOBILE | OFFLINE | BACKEND | STATUS | EVIDÊNCIA | AÇÃO

## Legenda de status (vocabulário fixo)

| Status | Significado |
|---|---|
| VERIFIED | Implementado e coberto por teste automatizado (ou evidência manual registrada em doc) citado na coluna Evidência |
| PARTIAL | Implementado em parte; a lacuna está dita em Evidência/Ação |
| UNVERIFIED | Sem evidência no repositório (suíte ausente); nada afirmado |
| PENDING_VALIDATION | Fato Sankhya/negócio ainda não validado em `docs/sankhya-spike.md`; não inventar |
| BLOCKED_EXTERNAL_SECRET | Depende de credencial/autenticação Sankhya real (segredo externo indisponível); não é defeito do Force |
| DECISAO_NEGOCIO_PENDENTE | Aguarda decisão do owner (ex.: R35/R36); não bloqueia a finalização técnica |
| NOT_IN_SCOPE | Fora do escopo do PLAC/da fase por decisão ou não usado (reconfirmar quando indicado) |

## Contagem por status (37 linhas)

| Status | Linhas |
|---|---|
| VERIFIED | 14 |
| PARTIAL | 8 |
| BLOCKED_EXTERNAL_SECRET | 6 |
| PENDING_VALIDATION | 5 |
| NOT_IN_SCOPE | 2 |
| DECISAO_NEGOCIO_PENDENTE | 1 |
| UNVERIFIED | 1 |

## Matriz

| # | Funcionalidade | Vidya/Sankhya | Web | Mobile | Offline | Backend | STATUS | Evidência | Ação |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Login operacional (vendedor/gerente, credenciais Sankhya) | TSIUSU; MobileLoginSP.login → CORE_E01434 | tela de login existe | tela de login existe | sessão offline AUTH-2 PROPOSED | `AUTH_MODE=local` recusa seller/manager de forma uniforme; login externo sem rota e `externalLogin` indefinido (`auth-config.ts:47,92`); porta `ExternalIdentityVerifier` só com dublês | BLOCKED_EXTERNAL_SECRET | `.claude/work/auth-spike/sankhya-login-probe.mjs`; BLOCKERS_PREPROD.md; `apps/server/test/integration/auth-local-mode.test.ts` (recusa operacional, sem rota externa); `external-login.test.ts` (com verificador falso) | Credenciais de TESTE ou saída do probe; decidir mecanismo (STACK-2) |
| 2 | Login admin local (Argon2id, só `admin`) | — | `WEB_AUTH_MODE=local` aceito (`40-runtime-config.sh`, `runtime-config.ts`) | n/a (operacional recusado) | n/a | `AUTH_MODE=local`: `allowedRoles=['admin']`; `ALLOW_DEV_AUTH` proibido com `local`; dev recusado em production | VERIFIED | `auth-local-mode.test.ts` (7 refs), `auth.test.ts`, `test/unit/env.test.ts`; web `app.test.tsx:113`, `lib/lib.test.ts:32`; commits ef3bde8, db9a943, 555243a | Manter; criar 1º admin pelo `account-cli` (ver #34) |
| 3 | Falha de login uniforme, bloqueio progressivo, falha de auditoria | — | — | — | — | `invalid_credentials` uniforme; falha de auditoria na recusa ainda devolve 401 (`auth.service.ts:529-535`); lockout vale para conta operacional recusada | VERIFIED | `auth-local-mode.test.ts` (lockout, sessão antiga não resolve); `external-login.test.ts:306` (audit store caindo); commits eee4492, 7aaf60b | — |
| 4 | Recusa de contas demo em produção | — | — | — | — | Boot em production recusa se houver `*.demo.salesforce.local` ou se a verificação falhar (fail closed); override só com `SF_ALLOW_DEMO_ACCOUNTS=true` | VERIFIED | `apps/server/test/integration/demo-accounts-check.test.ts` (10 casos); `platform/demo-accounts-check.ts`; `main-api.ts:26`; commits c0fd14d, 8a7ea97 | Não repassar o override no staging |
| 5 | Vínculo usuário→vendedor provisionado localmente | — | via conta | via conta | sim | `account_seller_link`; CHECK `seller_code >= 1`; sem vínculo = `NO_SELLER_SCOPE` | VERIFIED | `no-seller-scope.test.ts`; migração `0006_account_seller_link_seller_code_check.sql`; commit 6cb7cfc | — |
| 6 | Resolução usuário→vendedor no login (TSIUSU.CODVEND→TGFVEN) | TSIUSU.CODVEND (F-33/F-34); ativo/bloqueio TSIUSU PENDING_VALIDATION | — | — | — | não existe adaptador real | BLOCKED_EXTERNAL_SECRET | `docs/sankhya-spike.md` F-33/F-34; depende do #1 | Implementar só após credenciais/verificador real |
| 7 | Carteira (escopo por vendedor/gerente) | TGFPAR.CODVEND | ok | ok | cache | política central server-side | VERIFIED | `authorization-matrix.test.ts`; `packages/domain/test/scope.test.ts`, `customer-eligibility.test.ts`; mobile-spike §8.8 (250 clientes, dev) | Reconfirmar com login real e dados reais (depende #1) |
| 8 | Clientes (lista/busca/detalhe) | TGFPAR | ok | ok | cache ok; busca offline: sem evidência | espelho `erp_customer` | PARTIAL | `commercial-catalog.test.ts`; mobile `customers-screen.test.tsx`; `packages/mobile-db/test/customer-cache.test.ts`; busca offline sem evidência | Provar busca offline (FTS5 inutilizável, mobile-spike §8.1) |
| 9 | Cidade/UF/endereço/contatos | TGFPAR | parcial | parcial | — | colunas `city`, `state`, `phone` em `mirror.ts:59-61`; endereço completo/contatos: sem evidência | PENDING_VALIDATION | `packages/db/src/schema/mirror.ts`; leitura real do endereço: sem evidência | Auditar campos em TESTE |
| 10 | Produtos (V/R configurável, ativo) | TGFPRO | ok | ok | cache | espelho; uso vendável vem de configuração (CFG-3) | VERIFIED | `commercial-catalog.test.ts`; `packages/domain/test/product-mobility.test.ts`; `mobile-db/test/product-cache.test.ts` | — |
| 11 | Grupos de produto | TGFGRU, raiz -999999999 | sem evidência de UI | sem evidência de UI | — | `readProductGroups` rejeita pai 0 anômalo e ignora grupo 0 | PARTIAL | `packages/sankhya/test/real-mirror-reads.test.ts:49,62` (grupo 0 / pai 0); UI: sem evidência | Auditar árvore/ciclos na UI |
| 12 | Imagens de produto | fonte desconhecida (spike: "no image column") | `product-image.tsx` | `image-store.ts` | cache de imagem | porta `ProductImageSource`; implementação padrão `NoImageSource` (sem imagens); sem fonte real | BLOCKED_EXTERNAL_SECRET | `apps/server/test/integration/product-images.test.ts` (com `FakeImageSource`), `test/unit/product-image.test.ts`; `docs/sankhya-spike.md:706`; commit cfbe84a | Consultar dicionário TESTE (anexos/TGFPRO) com credenciais; implementar fonte real depois |
| 13 | Tabelas/preço atual | TGFNTA/TGFEXC (versões 0,3,5,6,9 no relato) | ok | catálogo mostra "Sem preço" sem tabela de referência; cache usa tabela de referência, não a do cliente (mobile-spike §8.8) | cache | resolução por tabela do cliente / fallback / `catalogReferenceTableCode` | PARTIAL | `packages/domain/test/pricing.test.ts`; `configuration.test.ts`; commit e7e113a | Owner: preço de referência no catálogo mobile; V-14 snapshot |
| 14 | Preço zero/ausente/negativo | — | "Sem preço" | "Sem preço" | ok | ausente ≠ 0; negativo rejeitado antes do lote; fail closed | VERIFIED | `pricing.test.ts:229` (zero explícito), `:266` (nunca vira zero), `:306`; commit e7e113a | — |
| 15 | CODTABALT=5 | — | — | — | — | inativo no relato | PENDING_VALIDATION | VIDYA_PARITY_MATRIX; sem evidência nova | Não usar |
| 16 | Promoções | TGFDES vazia (relato) | — | — | — | — | NOT_IN_SCOPE | VIDYA_PARITY_MATRIX; reconfirmar em TESTE | Não implementar |
| 17 | Desconto por item (estrutural 0–99,99 %) | DISC-1 | ok | ok (item/massa/grupo) | ok | revalidado server-side | VERIFIED | `docs/decisions.md` DISC-1; `commercial-orders.test.ts`; mobile `new-order-screen-discounts.test.tsx`, `group-discount`/`discount` testes; `0004_sales_order_item_discount_percent.sql` | — |
| 18 | Autoridade de desconto (R35 base, R36 roteamento/teto) | P-10 | — | — | — | não implementada (DISC-1 sem teto/aprovação) | DECISAO_NEGOCIO_PENDENTE | `docs/decisions.md` DISC-1, R35/R36/R37 UNDECIDED; BLOCKERS_PREPROD.md nota R35/R36 | Decisão do owner; não bloqueia o técnico |
| 19 | Cabeçalho/itens/carrinho/rascunho | TGFCAB/ITE | ok | ok | rascunho local | idempotente (`client_request_id`) | VERIFIED | `commercial-orders.test.ts`, `order-integrity.test.ts`; mobile `new-order-screen*.test.tsx`; mobile-spike §8.8 (pedido 6, R$ 873,96) | — |
| 20 | Camada de configuração da instalação (sem literais de cliente) | CFG-1…6 | config | config | cache | snapshot no banco, `configuration` service | VERIFIED | `configuration.test.ts` (server), `order-entry-configuration.test.ts`, `packages/domain/test/configuration*.test.ts` | — |
| 21 | Valores reais de TOP / empresa / local / layout / pagamento | relato 1001 / 1 / 209 / 30 | — | — | — | consumidos de configuração; origem Sankhya ainda PROPOSED (CFG-1) | BLOCKED_EXTERNAL_SECRET | VIDYA_PARITY_MATRIX (relato); `docs/sankhya-spike.md` §9.44-9.45 | Revalidar no TESTE quando houver credenciais |
| 22 | Negociação / transportadora | TGFTPV; CODPARCTRANSP | sem evidência | sem evidência | — | campo de negociação presente nos pedidos (`order.mapper`/`orders.service`); regra PLAC não confirmada | PENDING_VALIDATION | grep em `apps/server/src/orders/*`; regra de negócio: sem evidência | Definir se PLAC usa |
| 23 | Orçamento (tipo de documento) | — | sem evidência | sem evidência | — | — | PENDING_VALIDATION | `docs/sankhya-spike.md` §9.45 (lacuna de dados) | Confirmar uso |
| 24 | Duplicar / repetir último / modelos de pedido | — | ok (modelos, repetir) | não implementado (sem ocorrência em `apps/mobile/src`) | — | endpoints com guard de dataset em criar/atualizar/repetir (`templates.service.ts:93,168,239`) | PARTIAL | `order-templates.test.ts`, `repeat-last-order.test.ts`, `product-resolutions.test.ts`; web `order-templates.test.tsx`, `repeat-last-order.test.tsx`; commits 58ab462, 6cb7cfc | Mobile: decidir se entra |
| 25 | Histórico (pedidos anteriores do ERP) | TGFCAB histórico | lista de pedidos Force com filtros | lista de vendas Force | cache | histórico do ERP não espelhado | PENDING_VALIDATION | web `routes/orders.tsx`; mobile `sales-screen.test.tsx`; histórico ERP: sem evidência | Gap até dados reais |
| 26 | Status local de sincronização do pedido | — | — | ok | ok | — | VERIFIED | `apps/mobile/src/offline/sales-status.test.ts`; mobile-spike §8.8 ("Aguardando envio" → "Sincronizado") | — |
| 27 | Status ERP do pedido (GETCODSTATUS_VIDYA 0–6,-1) | TGFCAB/status | sem evidência | sem evidência | — | não há leitura de pedido do ERP; `integration_outbox` vazia (SNK-6) | BLOCKED_EXTERNAL_SECRET | `docs/mobile-spike.md` §8.8; VIDYA_PARITY_MATRIX | Consumer de status depende de credenciais |
| 28 | Sync / idempotência / conflitos / needs_review | — | — | ok | ok | `client_request_id` único; `needs_review` (`customer_ineligible`) só em rascunho | PARTIAL | `order-integrity.test.ts`, `customer-ineligible.test.ts`; `packages/mobile-db/test/offline-sync.test.ts`; mobile-spike §8.8 (dispositivo, LAN dev); perda de resposta só em teste; V-14 snapshot completo; MOB-6 aguarda confirmação de redação (CURRENT.md) | Testes de confiabilidade; roadmap mantém sync em execução gated |
| 29 | Descarte de rascunho | DraftDiscardError | — | só local não enviado | — | recusa se pode já estar no servidor | PARTIAL | `packages/mobile-db/src/order-sync.ts:598`; `quarantine.test.ts`, `quarantine-screen.test.tsx:88-123` | Semântica arquivar/cancelar: decisão do owner |
| 30 | Rascunhos legados em quarentena | — | — | tela de quarentena, só leitura + descarte confirmado | — | `dataset_origin='legacy_dev'` impede envio ao ERP | VERIFIED | `apps/mobile/src/ui/quarantine-screen.tsx` + `.test.tsx`; `mobile-db/test/quarantine.test.ts`; commit 5e95125; migração 0005 | — |
| 31 | Guarda de dataset / ambiente | — | ok | ok | ok | `expectedDataset` por mutação; CHECK + trigger em 0005 | VERIFIED | `dataset-guard.test.ts` (5 casos), `test/unit/dataset-guard.test.ts`, `erp-eligibility-guard.test.ts`, `mobile-db/test/dataset-isolation.test.ts`; commit eaf46ae | Dívida: id de dataset manual PROPOSED |
| 32 | Permissões / perfil / logout / revogação / sem custo-margem | P-20/P-21 | ok | ok | wipe no logout | política central; DTO sem custo/margem | VERIFIED | `authorization-matrix.test.ts`; `product-images.test.ts` e `commercial-catalog.test.ts` (`restrictedKeys`); mobile-spike §8.8 (38/38 `/products`) | Reprovar com perfis reais pós-auth (depende #1) |
| 33 | Atualização/distribuição do app mobile | — | — | configuração de release só https (5e95125); cleartext só em build DEV fail-closed (`with-dev-cleartext.js`) | — | — | PARTIAL | commits 5e95125, 49740de; `apps/mobile/src/config.test.ts`; keystore de release própria: sem evidência (android/ é gerado e git-ignored; assinatura debug no gradle gerado) | Keystore própria e URL https de staging |
| 34 | Stack de staging (compose, só configuração) | — | nginx `WEB_AUTH_MODE` | — | — | `deploy/docker-compose.staging.yml`: `NODE_ENV=production`, sem seed/demo/dev auth, imagens fixadas, worker fake por padrão; nunca iniciado | PARTIAL | `deploy/README-staging.md`; FAKE_DEMO_SWEEP_2026-10-02.md; `docker compose config -q` não executado nesta sessão (sem evidência). Pendências: README não documenta 1º admin (`account-cli`, `ALLOW_REMOTE_DB=1`); `compose.env.example:22-24` e comentários `:98-99,174` desatualizados | Atualizar runbook/exemplo; rodar `compose config -q` com env de exemplo |
| 35 | Writer Sankhya (envio de pedido) | — | — | — | outbox, desabilitado | SNK-6: sem escrita; gates V-11/V-13; sem segundo write em Sandbox sem autorização | BLOCKED_EXTERNAL_SECRET | `docs/decisions.md` SNK-4/SNK-6; `sankhya.md` rules | Sem escrita |
| 36 | Performance, agenda, engajamento, mural | AD_TVDY* | — | — | — | — | NOT_IN_SCOPE | VIDYA_PARITY_MATRIX (a confirmar com o PLAC) | Não implementar |
| 37 | Suítes E2E (Playwright web, Maestro mobile) | — | sem evidência | sem evidência | — | — | UNVERIFIED | nenhuma pasta/suíte E2E no repositório (`apps/web` só vitest; mobile só jest); plataforma Maestro UNDECIDED R48 | Plano E2E dos fluxos críticos (login admin local, pedido) |

## Observações

- Itens que dependem de Sankhya real (#1, #6, #12, #21, #27, #35) permanecem BLOCKED_EXTERNAL_SECRET: SANKHYA_CLIENT_ID/SECRET/X_TOKEN chegam vazios ao container (BLOCKERS_PREPROD.md); nenhuma busca de segredo alternativa foi feita.
- R35/R36 (#18) = decisão de negócio pendente, fora do caminho crítico técnico.
- Correções de afirmações antigas após leitura do código: modelos de pedido agora têm guarda de dataset; quarentena de rascunhos legados agora tem tela; release mobile é https-only; login admin local, bloqueio de contas demo e falha de auditoria uniforme existem e têm testes.
- Varredura fake/placeholder: ver FAKE_DEMO_SWEEP_2026-10-02.md (substitui a seção do rascunho anterior).
