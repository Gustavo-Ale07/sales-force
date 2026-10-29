# SALES FORCE AUDIT LOG

STATUS: PLAN_AUDIT_DONE — implementação autorizada a começar por Fase 0 + B1

## NOTA — wrap-up 2026-09-22 ~17h

Todo o trabalho auditado abaixo (Fases 0, B1, H1, B2, C, "Repetir último pedido", D, E, A, A2, A2b) mais a
Fase A3 (redesign visual, feita nesta sessão) foi COMMITADO no worktree `C:\Dev\sales-force-evolution`,
branch `feat/sales-force-evolution` (7 commits acima de `823eefa`, sem push). Nenhuma reauditoria/reexecução
de suíte completa foi feita nesta janela de wrap-up cronometrado — as auditorias abaixo continuam sendo a
evidência vigente. Detalhe completo do que foi commitado e do que falta: bloco HANDOFF no topo de
`SALES_FORCE_PROGRESS.md`.

## Objetivo

Registrar auditorias da nova evolução do Sales Force.

A auditoria deve procurar problemas reais e não apenas confirmar decisões anteriores.

## Auditoria 1 — Plano

STATUS: IN_PROGRESS (iniciada 2026-09-21)

Objeto: `SALES_FORCE_PLAN.md` §25 (plano técnico real v1).

Revisores (independentes, somente leitura):

| Revisor | Foco | Status |
|---|---|---|
| architect | decisões aprovadas, arquitetura, marca por config, modelo de templates, endpoint resolve, guard de rota | aguardando |
| security-reviewer | Integração/`/ready`, resolve/import, templates/IDOR, marca via config, repetir pedido | aguardando |
| code-reviewer | aderência requisitos×plano×código, reutilização, regressão, escopo, worktree | aguardando |

Verificar:

- aderência aos requisitos;
- arquitetura;
- reutilização;
- duplicação;
- segurança;
- autorização;
- regras comerciais;
- banco;
- APIs;
- contratos;
- performance;
- risco de regressão;
- escopo excessivo.

## Auditoria 2 — Implementação

STATUS: PENDING

Executar após cada grande bloco implementado.

Comparar:

REQUISITOS
x
PLANO
x
CÓDIGO REAL

## Auditorias críticas

Realizar auditoria específica quando houver alteração em:

- pedidos;
- preços;
- descontos;
- comissão;
- clientes;
- vendedores;
- permissões;
- autenticação;
- banco;
- Sankhya.

Checklist provisório por fase (do plano): B1 → security-reviewer; D (resolve/importação) →
security-reviewer; E (templates/migration/escopo) → security-reviewer + database-engineer (migration);
todas as fases → code-reviewer ao fim.

## Auditoria final

STATUS: PENDING

Verificar:

- requisitos;
- regressões;
- segurança;
- performance;
- acessibilidade;
- UX;
- UI;
- consistência;
- regras comerciais;
- testes;
- documentação.

## Resultado da Auditoria 1 (2026-09-21) — CONCLUÍDA

Veredictos: architect = APROVADO COM AJUSTES · security-reviewer = APROVADO COM AJUSTES (sem
bloqueante) · code-reviewer = APROVADO COM AJUSTES. Todos os ajustes foram incorporados em PLAN §25.9
(plano v2). Achados e disposição:

| # | Sev. | Origem | Achado | Disposição |
|---|---|---|---|---|
| 1 | ALTA | arch+code | D/E antecipam itens da Fase 1 (roadmap:91) e templates não têm RF-* | Aceito parcialmente: a instrução explícita do dono (CURRENT.MD + briefing) tem precedência 1 (CLAUDE.md §1) e nomeia importação, repetir e recorrentes. Registrar a antecipação em `docs/roadmap.md` ao iniciar D/E; templates = MVP mínimo, regra de acesso = escopo do cliente (sem regra nova de papéis) |
| 2 | ALTA | sec | `/ready` autenticado vaza detalhe a qualquer perfil (`health.controller.ts:35`, `auth.service.ts:234`) | Corrigir em B1: detalhe só se `authorizeRoute(user,'getConfiguration')`; `peekSession` sem renovar cookie; manter o pill para todos |
| 3 | ALTA | arch+sec | Duplicar a matriz de roles no cliente | Fonte única `INTEGRATION_ROLES` em `packages/contracts` usada por `policy.ts` e pelo front |
| 4 | ALTA | sec | Template: escopo por `seller_code` congelado / criador manteria acesso após reatribuição; corrida de reatribuição | Sem `seller_code`; escopo pelo cliente vivo (`JOIN erp_customer`), `FOR SHARE` no cliente + `FOR UPDATE` no template; qualquer ator no escopo lê/usa/edita/apaga (sem regra por criador) |
| 5 | ALTA | sec | `resolve` como oráculo (oculto/inativo/sem preço) | Aplicar `isProductVisible`; oculto ⇒ "não achado"; match exato, `= ANY`, ≤5 candidatos, DTO `ProductListItem` |
| 6 | ALTA | code | Enter no campo de quantidade faz submit implícito e SALVA o rascunho (`order-editor.tsx:301,395`) | Fase D: `preventDefault` + teste de regressão |
| 7 | ALTA | code | "Repetir" falha inteiro por 1 produto indisponível (`draft-builder.ts:59`); "último pedido" ambíguo | Definir: último = mais recente NÃO cancelado; produtos indisponíveis listados como aviso e o restante é copiado; só `productCode`+`quantity` (sem notes/negociação); rascunho fica com o vendedor do cliente |
| 8 | ALTA | sec | Marca via config: validar `logoUrl`/`accent` (público, sem auth); não há CSP | Só caminho same-origin `^/[A-Za-z0-9._/-]+$`, cor `^#[0-9a-f]{6}$`, `style.setProperty`, invalidar ⇒ padrão; validar também em `40-runtime-config.sh`; CSP e `/brand/` com sandbox nas nginx locations |
| 9 | MÉDIA | arch | `/products/resolve` colide com `/products/{code}` | `POST /product-resolutions` |
| 10 | MÉDIA | arch+sec | XLSX no navegador: zip bomb/limites/lib | Fase D entrega CSV/colar primeiro; XLSX só depois de auditoria da lib e em Worker com limites descompactados; desvio de RF-IMP-2 (sem mapeamento auto/segundo plano) registrado |
| 11 | MÉDIA | code | Fatos errados no plano | Corrigido: 20 rotas; `SortableHead` já existe; `CustomerOrders` e "Novo pedido" no detalhe já existem; caminho `platform/` (não `health/`); `runtime-config` sem Zod (parse manual); bundle 195 kB gz (meta = não piorar + lazy) |
| 12 | MÉDIA | code | Ficha dentro do editor: estado perdido no remount `id:version`; links empilham modais | Ficha vive acima do remount; links internos desativados/nova aba dentro do editor; snapshot dirty não inclui seleção/desfazer |
| 13 | MÉDIA | code | Worktree sem node_modules; E2E fora dele | `pnpm install --frozen-lockfile` no worktree; E2E integra depois (fora da missão); manter nomes acessíveis usados pelos specs |
| 14 | MÉDIA | code | Itens do briefing sem destino (atalho Último pedido; filtros de período/produto em pedidos) | "Último pedido" = itens do último pedido local (Fase C); filtros período/cliente/status em Pedidos = MVP na Fase H; demais atalhos ficam fora (sem dado) |
| 15 | MÉDIA | code | Sem critérios de aceite mensuráveis | Adicionados em PLAN §25.9 |
| 16 | BAIXA | code | Falta DatePicker/MultiSelect (§18) | DatePicker só se a Fase H de filtros o exigir (input date nativo primeiro) |
| 17 | BAIXA | sec | Sem rate limit por conta em rotas de sessão | Lacuna transversal pré-existente; registrar como risco, fora desta missão |

Não confirmadas/derrubadas: nenhuma violação de decisão APPROVED encontrada (PROD-1, P-16, P-05/ARCH-1,
DATA-1 respeitados). ActiveFilters mantido como refatoração opcional (só se uma tela nova precisar).

## Histórico

- 2026-09-21: plano v1 enviado para Auditoria 1 (3 revisores). Concluída; plano v2 em PLAN §25.9.

## Auditoria 2 — Bloco B1 (Integração só para admin) — em andamento (2026-09-21)

Implementado em `C:\Dev\sales-force-evolution` (sem commit): `INTEGRATION_ROLES`/`canSeeIntegration`
(`packages/contracts/src/access.ts`), `policy.ts` (`getConfiguration`), `AuthService.peekSession` (substitui
`hasActiveSession`, leitura sem renovar), `/ready` com detalhe só se a política permite `getConfiguration`,
menu filtrado (`navSectionsFor`), pill só para quem vê Integração (e sem poll de `/ready`), guard em `/integracao`
(redireciona para `/`).

**Desvio consciente do achado #2 (disposição "manter o pill para todos"):** o briefing item 5 diz "Parte de
'Integração' nunca aparecer para o vendedor" (precedência 1, instrução do dono). O pill exibe o texto
"Integração: …", então foi ocultado para não-admin; o servidor continua sem vazar detalhe. Consequência: o vendedor
perde o indicador de "servidor indisponível" do topo (falhas continuam visíveis nos estados de erro das telas).

Testes: server api.test.ts (seller/manager recebem só o veredito grosso; peek não desliza a sessão) — verde;
web (menu/pill/guard/poll por perfil; telas de Integração como admin) — verde. Pendente: security-reviewer.

## Auditoria 2 — Fase A (visual/marca/motion)

Revisores: security-reviewer (APROVADO COM AJUSTES) e code-reviewer (APROVADO COM AJUSTES). Sem achado crítico/alto.

| # | Sev. | Achado | Disposição |
|---|---|---|---|
| A1 | MÉDIA | CSP `style-src 'self'` bloquearia o `<style>` injetado pelo scroll-lock do Radix (react-remove-scroll) | CORRIGIDO: regra estática `body[data-scroll-locked]` em `index.css`; CSP mantida estrita. PENDENTE: verificar em navegador real (Dialog/Drawer, console sem violações) — jsdom não aplica CSP |
| A2 | MÉDIA/BAIXA | `grep` por linha: valor BRAND_* multilinha passava e gerava JSON inválido | CORRIGIDO: `case` recusa qualquer caractere fora de `A-Za-z0-9._/#-` antes do padrão; reexecutado em alpine (multilinha, espaço final, válidos) |
| A3 | MÉDIA | Sem fallback quando logo/marca não carrega | CORRIGIDO: `Brand` cai logo → marca → placeholder+nome; teste com `fireEvent.error` |
| A4 | MÉDIA | Acento validado só contra branco a 4,5 (falha como texto em superfícies claras) | CORRIGIDO: mínimo 5,5:1 (README atualizado); testes com cor limítrofe |
| A5 | BAIXA | `--sf-ease`/`--sf-duration` sem uso | CORRIGIDO: removidos (tokens especulativos); botão mantém `duration-150 ease-out` |
| A6 | BAIXA | teste de tokens dependia do cwd | CORRIGIDO: `import.meta.dirname` |
| A7 | BAIXA | Cache /brand/ 1h | ACEITO (troca de logo é rara; documentar se incomodar) |
| A8 | BAIXA | `--sf-ring` fixo em teal sob acento custom | ACEITO/registrado: anel de foco fixo; derivar depois se o dono pedir |
| A9 | BAIXA | Card sem overflow-hidden com Table: cantos retos sobrepõem borda de 8 px | PENDENTE: inspeção visual em navegador (não adicionar overflow-hidden às cegas: anel de foco/thead sticky) |
| A10 | BAIXA | Sem width/height na imagem (layout shift); <title> fixo | ACEITO (fora do escopo do plano) |

Verificação: web lint e typecheck verdes; 193 testes (9 arquivos); build ok; bundle 197,60 kB gz (> 195: H1).
nginx: `nginx -t` ok, cabeçalhos por location observados em container; script de config testado em alpine.

## Auditoria 2 — Fase A2 (refinamento visual Smilo: fonte/raio/sombra) — verificação própria

Sem auditoria independente própria ainda (mudança contida a um arquivo de tokens CSS, `packages/ui/src/styles/index.css`,
sem lógica de negócio/autorização/dado sensível — não bate nenhum gatilho de `security-model.md` §15). Reabre a
decisão de raio da Fase A (6/8/12 → 8/12/18px) com autorização do dono ao vivo (`AskUserQuestion`, 2026-09-22,
escopo "Visual mais completo"). Verificação própria: typecheck/lint/test de `packages/ui` limpos; build de
`apps/web` ok (fontes auto-hospedadas em `dist/assets/*.woff2` com hash do Vite, confirmando resolução correta
pelo pipeline de assets); CSP não mudou (`font-src 'self'` já cobria, fontes same-origin por design).

Risco residual identificado, NÃO auditado visualmente: o achado A9 (Card+Table, cantos retos sobrepondo borda
com o raio de 8px) fica mais provável de ficar visível com o raio base agora em 12px — mesma causa (falta
`overflow-hidden` no Card), risco maior. Recomendação: tratar A1/A9/A2-visual como um único lote de verificação
em navegador antes do commit desta fase, e considerar aplicar o `overflow-hidden` do A9 junto (não fazer às
cegas sem ver o resultado, mesma cautela já registrada no A9 original).

## H1 — code splitting (verificação própria)
Sem auditoria independente própria (mudança mecânica, coberta pelos 193 testes de telas que agora aguardam os
chunks lazy); será revista pelo code-reviewer junto com B2. Bundle inicial 126,56 kB gz. Risco residual:
falha de rede ao baixar um chunk — o `RouteError`/pending do router cobre o estado; recarregar resolve.

## D — pedido rápido / product-resolutions (2026-09-21)
Revisão de segurança (security-reviewer): APROVADO COM AJUSTES. Disposição:
- (a) asserção de startup de que todo `maxBodyBytes` declarado casou com uma rota: APLICADA (`create-app.ts`, `onReady`;
  só com o módulo real, não em módulos de teste parciais).
- (b) teto do corpo 64 → 128 kB (500 × 40 caracteres não-ASCII passava de 64 kB): APLICADO (contrato, OpenAPI regenerado, testes).
- (c) sem rate limit nas rotas de leitura: ENDURECIMENTO GERAL registrado, não bloqueia (rota exige sessão, corpo limitado, ≤ 500 ids).
- (d) plano de consulta `reference = any(text[])` (só existe GIN trigram): PENDENTE database-engineer; com ≤ 500 ids e
  catálogo espelhado pequeno o risco é baixo, medir antes de indexar.
Verificação própria: web 224 testes; typecheck da web exigiu tipo estreito (`Resolution`) por causa da lacuna conhecida
de `null` do cliente tipado (ver `price-types.ts`). Reexecutados: product-resolutions 19/19, api, matriz.
Limites conhecidos: XLSX ausente; duplicados sinalizados e não somados; `EVERY_ROLE` é suposição (perguntas em PLAN §25.9).
Pendente: auditoria code-reviewer de H1+B2+C+D; verificação em navegador (A1/A9); E2E Playwright.

## Revisão code-reviewer de H1+B2+C+D (2026-09-21) — APROVADO COM AJUSTES; ajustes aplicados
| # | Sev. | Achado | Disposição |
|---|---|---|---|
| 1 | ALTA | Limpar o cliente (Backspace) e depois escolher outro mantinha as linhas com preços do cliente anterior | CORRIGIDO: a confirmação depende das linhas, não do cliente atual; "remover o cliente" também pede confirmação; testes (recusar / confirmar / escolher outro) |
| 2 | MÉDIA | "Desfazer" após trocar de cliente restaurava linhas com preços do cliente antigo | CORRIGIDO: troca limpa `removed` e `selected`; teste |
| 3 | MÉDIA | Foco perdido após "Remover selecionados" e "Desfazer" | CORRIGIDO: foco vai para "Desfazer" e, depois, para "Adicionar produto"; teste |
| 4 | BAIXA | Cliente removia só C0/DEL; o servidor recusa também C1 (um NEL derrubava o lote) | CORRIGIDO (`\u007f-\u009f`); teste unitário |
| 5 | BAIXA | Identificador numérico normalizado ("007" → código 7) | CORRIGIDO no servidor: só dígitos canônicos (sem zero à esquerda) casam por código; "007" só casa por referência; descrição da rota e teste atualizados. OpenAPI será regenerado na entrega da Fase E (mesmo arquivo) |
| 6 | BAIXA | `leftIcon` ignorado com `asChild` (B2) | CORRIGIDO: ícone dentro do `Link` |
| 7 | BAIXA | Revisão obsoleta se o texto muda durante a conferência | CORRIGIDO: textarea e arquivo desabilitados enquanto confere |
| 8 | BAIXA | B2 oferece "Novo pedido" a cliente inativo/bloqueado | ABERTO: sem regra documentada; o servidor revalida. Perguntar ao dono (não inventar regra) |
| 9 | — | Ruído de prettier no order-editor; mudanças não relacionadas (marca, nginx, /ready, getConfiguration) e revisão de segurança dessas | Commits separados por tema ao autorizar; security-reviewer ainda deve revisar `/ready` e `getConfiguration` (§15) |
Verificação: web lint/typecheck verdes, 228 testes.

## Fase E — esquema (database-engineer, 2026-09-21)
Migração expand-only `0003_customer_order_template` (2 tabelas novas, 2 FK, 2 índices únicos; nenhuma tabela existente alterada).
CHECK de nome usa `~ '[^[:space:]]'` (o teste pegou que `btrim` não remove tab/quebra de linha). db: lint/typecheck/build e 43 testes verdes.
Consulta de resolução (`reference = any(text[])`): EXPLAIN em 4k/50k/300k produtos = 1,4/16/≈30 ms (Seq Scan); índice NÃO necessário
(fecha o item (d) da revisão de segurança). Risco: limite de 50 templates/cliente é contagem+insert — o serviço deve travar o cliente (FOR SHARE).

## Fase E — servidor (backend-engineer, 2026-09-21) — aguardando security-reviewer
Rotas `order-templates` (list/create/get/replace/delete/use), 6 linhas em `ROUTE_POLICY` (EVERY_ROLE, igual às rotas de pedido) e na matriz.
Limites: 50 templates/cliente, 500 itens, nome 1..80 (único por cliente, sem diferenciar caixa, entre vivos). Escopo pelo cliente (404 idêntico
fora do escopo/inexistente/apagado); trava por cliente (advisory) → FOR SHARE cliente → FOR UPDATE template. "Usar" cria rascunho novo pelo mesmo
caminho de `createOrder` (preço só do catálogo atual; linhas inelegíveis voltam em `skippedLines`; nenhuma utilizável = 409 `no_usable_lines`).
Auditoria com ids/contagens. Testes: servidor 438 (40 novos de templates), contracts 72 + `openapi:check`, domain 202; lint/typecheck/build verdes
(resultado do agente; reexecutarei o gate final). SUPOSIÇÕES a confirmar com o dono: qualquer ator no escopo edita/apaga qualquer template do cliente;
template pode conter produto hoje inelegível (checado só no uso); nome do template volta nas respostas (fora da auditoria).
Risco: FOR SHARE em `erp_customer` exigiria UPDATE a um futuro papel de banco restrito.

## Fase E — revisão security-reviewer (2026-09-21) — ACEITÁVEL (sem CRITICAL/HIGH/MEDIUM)
| # | Sev. | Achado | Disposição |
|---|---|---|---|
| 1 | BAIXA | `use` distingue produto oculto/não vendável (`product_hidden`/`product_not_sellable`) de removido: oráculo de existência para papéis não-admin | CORRIGIDO: para não-admin, `product_hidden`/`product_not_sellable` voltam como `product_removed` (`presentSkips`); admin vê o motivo real; teste |
| 2 | BAIXA | `use` lê as linhas do template antes do lock do template; edição concorrente pode ser usada com linhas velhas | CORRIGIDO: `beforeInsert` compara a versão travada com a lida (`version_conflict`, nenhum pedido); teste. Server order-templates 42/42, lint/typecheck verdes |
| 3 | NOTA | `order-editor.tsx` chama `getConfiguration` (só admin, igual ao HEAD): para gerente/vendedor volta 403 e a lista de tipos de negociação, o padrão e a pré-checagem ficam vazios | PRÉ-EXISTENTE, não é regressão (o servidor valida tudo). Requer endpoint de leitura de configuração comercial acessível a não-admin: toca autorização; registrar como pergunta ao dono / decisão, sem inventar regra |

## Fase E — revisão code-reviewer (web + passada no servidor) (2026-09-21) — APROVADO COM AJUSTES (sem CRITICAL/HIGH)
| # | Sev. | Achado | Disposição |
|---|---|---|---|
| 1 | MÉDIA | "Usar" gera chave de idempotência nova a cada clique, inclusive após falha de rede/5xx (rascunho duplicado se a resposta se perde) | CORRIGIDO: `requestIds` (`useRef<Map<string, string>>`) em `order-templates-card.tsx` guarda `{templateId → clientRequestId}`, reusado até sucesso ou 4xx definitivo |
| 2 | MÉDIA | Diálogo de edição remonta o formulário quando o refetch traz nova versão e descarta o que o usuário digitou | CORRIGIDO (2026-09-22): causa era `EditBody` devolver tipos de componente diferentes entre loading/error (`DialogContent` direto) e o ramo "form" (`EditForm`, com `DialogContent` próprio) — o React desmontava/remontava o Portal do Radix ao trocar de tipo na mesma posição. Unificado um único `DialogContent` em `EditBody`; rodapé repassado de `EditForm` via `useLayoutEffect` (`onFooterChange`), pois `EditForm` só monta condicionalmente. Teste (linha ~361 de `order-templates.test.tsx`) verde |
| 3 | BAIXA | Enter na busca de produto do diálogo de edição salva o modelo (PUT que substitui tudo) | CORRIGIDO (2026-09-22): bloqueio (`blockEnterSubmit`) já existia; o teste que faltava fechar expunha limitação do `@testing-library/user-event` (não localiza botão de submit associado só por `form=` fora do `<form>`, nem aplica o fallback de único input com vários campos) — não um bug real, navegadores respeitam a associação por `form=`. Teste reescrito para checar `defaultPrevented` do keydown (`fireEvent.keyDown`) e o `onSubmit` via `fireEvent.submit` nativo, com o porquê documentado no próprio teste |
| 4 | BAIXA | `version_conflict` em "Usar" mostra texto de formulário e não atualiza a lista | CORRIGIDO: `order-templates-card.tsx:135` invalida `orderTemplatesAll` também em `version_conflict`, não só 404 |
| 5 | BAIXA | 404 no diálogo de edição não atualiza a lista | CORRIGIDO: `order-template-edit-dialog.tsx:90-92` invalida `orderTemplates(customerCode)` quando `notFound` |
| 6 | BAIXA | Erro de nome duplicado aparece duas vezes na edição | CORRIGIDO (`failure && !nameTaken`, linha 266) |
| 7 | BAIXA | Asserção fraca (`toHaveTextContent("2")`), constante não usada, limites copiados do contrato | CORRIGIDO: assertion/constante antigas não existem mais no arquivo |
| 8 | BAIXA | Navegação após "Usar" espera invalidações | CORRIGIDO: invalidações (`orderTemplates`, `ordersAll`, `dashboard`) disparadas sem `await` antes do `navigate` |
| 9 | BAIXA | Texto do conflito na edição após resposta perdida | CORRIGIDO (texto neutro em `describeTemplateError`) |

Verificação final do gate (2026-09-22, workspace inteiro): lint, typecheck e build verdes em todos os pacotes;
testes domain 202, contracts 72, db 43, sankhya 139, server 440, web 256 (todos os 9 achados acima cobertos por
teste verde); bundle web entry 125,80 kB gz. Achados #2 e #3 (únicos ainda com teste vermelho ao retomar a
sessão) detalhados nas suas próprias linhas acima. Fase E: gate fechado, pendente só navegador/Playwright e as
perguntas ao dono já registradas.

## C-restante — "Repetir último pedido" (2026-09-22) — CONCLUÍDA, revisões fechadas

Servidor (backend-engineer): reaproveita o mecanismo de "usar modelo" (Fase E) — `OrdersService.repeatLast`
busca o pedido não cancelado mais recente do cliente (`OrdersRepository.findLatestForCustomer`, escopo +
`ORDER BY draft_number DESC`), reclassifica linhas contra o catálogo atual (`DraftBuilder.classifyTemplateLines`)
e cria pelo `OrdersService.create` normal (vendedor sempre o atual do cliente; pedido origem intocado). Rota
`POST /customers/{code}/orders/repeat-last` (`repeatLastOrder`), 409 `no_previous_order` / `no_usable_lines`
(+`skippedLines`), auditoria `order.repeated_from_last`. Desvio técnico: `RepeatLastOrderResponseSchema` ficou
em `templates.ts` (não `orders.ts`) para evitar import circular; contrato final idêntico, exportado da raiz.
Web (frontend-engineer): botão "Repetir último pedido" ao lado de "Novo pedido" na ficha do cliente
(`customer-detail.tsx`); `TemplateNoticeState` generalizado para `OrderNoticeState` (`source: "template" |
"repeat-last"`) para o aviso de linhas puladas em `/pedidos/$id` funcionar para as duas origens.

| # | Sev. | Achado | Disposição |
|---|---|---|---|
| 1 | MÉDIA (code-reviewer) | `presentSkips` (máscara P-21 de motivo de skip para não-admin) duplicada byte-a-byte em `orders.service.ts` e `templates.service.ts` — regra de negócio pura sem dependência de infra, deveria estar em `packages/domain` | CORRIGIDO (2026-09-22): movida para `packages/domain/src/templates.ts` (`presentSkips(role, skipped)`, assinatura por `AccountRole` para não acoplar a `CurrentUser`); os dois serviços passaram a importar de `@salesforce/domain`; cópias locais removidas; +3 testes de domínio (todos os 6 `TemplateLineSkipReason` × papéis, não-mutação do input) |
| 2 | BAIXA (security-reviewer) | `repeatLast` resolve "pedido mais recente" e reclassifica linhas ANTES de checar `clientRequestId` — diferente de `create()` (que checa idempotência primeiro); um retry após o pedido-origem ser cancelado ou um produto ficar indisponível entre as duas chamadas podia cair em `no_previous_order`/`no_usable_lines` em vez de devolver o rascunho original | CORRIGIDO (2026-09-22): `findByClientRequestId` agora é a primeira coisa feita (depois só do escopo/cliente visível), validando dono+cliente+escopo contra a linha gravada em vez de fingerprint de conteúdo (a requisição só carrega `clientRequestId`, sem itens, então validar por fingerprint exigiria reclassificar primeiro — o que anularia o próprio conserto). Desvio assumido: replay devolve `skippedLines: []` (não persistido) em vez do aviso original — identidade do pedido (id/itens/status/totais) é idêntica no replay (P-08), só a lista informativa de puladas não é reconstituída sem reclassificar; só muda comportamento quando a chamada original tinha linhas puladas. Se isso importar, a correção real é persistir `skippedLines` por pedido — decisão de schema para `database-engineer`/dono, fora do escopo desta correção BAIXA. 2 testes novos provando o retry após o estado mudar (pedido-origem cancelado + produto desativado; e o caso extremo de zero pedidos não-cancelados restantes) |

Verificação (2026-09-22): domain 205/205 (+3) e `domain boundary check passed` — reexecutado nesta sessão,
independente do relato do agente; server `repeat-last-order.test.ts` 21/21 (19+2) — reexecutado nesta sessão;
demais números do agente (não reexecutados por mim: server suíte completa 465, `order-templates.test.ts` 42/42,
typecheck/lint domain+server limpos) aceitos com a ressalva de não terem sido conferidos por fora. Nenhum gatilho
de `security-model.md` §15 novo (P-21 só realocada, sem mudança de forma). Pendente: navegador/Playwright para a
UI nova (frontend-engineer sinalizou a mesma lacuna de Fase A/E — sem ferramenta de navegador na sessão).

## Fase A2b — identidade PLAC (preview local de marca) — verificação própria (2026-09-22)

Mudança: `apps/web/public/brand/plac-logo.png` (asset novo, cópia de imagem já existente no vault pessoal do
dono, nenhum dado gerado) + `apps/web/public/config.json` (dev) com `brand.logoUrl`/`brand.accent`, usando o
mecanismo de override de marca já auditado na Fase A (`runtime-config.ts` → `applyBrand()`, `parseBrandAsset()`/
`parseAccent()` inalterados). Sem código novo, sem migração, sem rota nova, sem dado sensível (é a logo pública
da empresa). Self-audit (sem revisor externo dispatchado): risco muito baixo, nenhum gatilho de
`security-model.md` §15 (não é auth/sessão/device/escopo/sync/custo-margem/segredo/CI/Sankhya/terceiro). O valor
de `accent` (`#001369`) só é aceito porque passa no próprio gate de contraste (`parseAccent`, ≥5,5:1) — não
contorna a validação, só usa um valor que já era válido para o campo. `config.json` de dev não é lido em
produção (produção usa `deploy/nginx/40-runtime-config.sh` com `BRAND_ACCENT`/`BRAND_LOGO_URL` de variável de
ambiente do dono, não este arquivo), então não há risco de vazar um valor de preview para uma instalação real.
Recomendação: nada bloqueante; incluir este item quando o code-reviewer/security-reviewer passar pelo lote
H1+B2+C+D+E+A2 (ver PROGRESS "Próximos passos exatos"), só para registro formal — não pelo risco, que é nulo.

## Auditoria 2026-09-25 — Evolução visual PLAC (lacunas vs. kit de referência)

| Área | Referência | Estado | Ação |
|---|---|---|---|
| Tokens/tipografia | Manrope, neutros quentes, raios 10/16/20 | Implementado | commit `6e90b00` |
| Topo | 80px navy + linha vermelha, pílula ativa | Implementado | idem |
| Breadcrumb duplicado | título já identifica a página | Corrigido (oculto se 1 item) | teste `app.test.tsx` ajustado |
| Nomes em CAIXA ALTA | Title Case | `titleCase` (só exibição, aria-label preservado) | teste unitário |
| Ação de linha | só no hover | Implementado em Clientes (toque mantém visível) | — |
| Ctrl K / sino | presentes no topo | NÃO feito (sem endpoint/dado; não simular) | decisão do dono |
| Desconto, VIP, positivação, etapas do pedido | presentes | BLOCKED (contrato/regras) | registrado |
| Login | reformatado | herdado dos componentes; sem inspeção visual | risco aberto |
