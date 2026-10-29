# SALES FORCE PLAC — MASTER PLAN

STATUS: DRAFT

> **ATUALIZAÇÃO 2026-09-23 — PIVÔ DE MISSÃO:** o dono determinou **PARIDADE TOTAL com o Vidya Force**
> nesta fase, substituindo a direção anterior de redesign visual Smilo. Isso ajusta as seções abaixo:
> "Não copiar o design do Vidya" (§2, VIDYA FORCE) **não se aplica enquanto durar esta fase** — a
> instrução vigente é replicar estrutura, navegação, densidade, abas, filtros, modais, tabelas e ações
> do Vidya (com identidade visual própria da PLAC, nunca a marca Vidya). SMILO como "Referência de
> EXPERIÊNCIA" (§2) fica para uma FASE 2 explicitamente adiada. Ver detalhes, ordem de implementação e
> matriz de paridade em `CURRENT.md`, `VIDYA_SCREEN_SPECS.md`, `VIDYA_PARITY.md` e `VIDYA_GAPS.md`. O
> restante deste documento permanece válido como pano de fundo (visão, princípio de Economia de Tempos
> e Movimentos, escopo funcional por área), exceto onde contradiz este pivô.

Este documento descreve os objetivos da evolução atual do produto.

Não assumir que este documento representa a arquitetura atual.
A arquitetura real deve ser descoberta no código antes da implementação.

# 1. VISÃO

Transformar o Sales Force da PLAC em uma ferramenta comercial moderna,
rápida, profissional e desenvolvida especificamente para a operação real
dos vendedores e representantes.

Princípio:

> Economia de Tempos e Movimentos.

Pergunta obrigatória durante decisões de UX:

> Existe uma maneira de realizar esta tarefa em menos etapas sem perder
> segurança, controle, informação ou rastreabilidade?

# 2. REFERÊNCIAS

## VIDYA FORCE

Referência FUNCIONAL.

Utilizar como inspiração para:

- Clientes;
- Ficha do Cliente;
- Dados Cadastrais;
- Financeiro;
- Análise do Cliente;
- Engajamento;
- Vendas;
- Produtos Vendidos;
- Histórico;
- Performance;
- criação de pedidos;
- lançamento múltiplo;
- importação de planilha;
- filtros comerciais;
- produtos comprados;
- produtos não comprados;
- último pedido;
- mais vendidos.

Não copiar o design do Vidya.

## SMILO

https://smilocenter.com.br

Referência de EXPERIÊNCIA.

Observar:

- UX;
- UI;
- fluidez;
- transições;
- microinterações;
- feedback;
- hierarquia;
- espaçamento;
- movimento;
- acabamento;
- continuidade entre ações.

Não copiar literalmente o site.

## PLAC

É a identidade FINAL.

Utilizar identidade visual, logo e linguagem da PLAC.

Resumo:

VIDYA = funcionalidade.
SMILO = experiência.
PLAC = identidade.

# 3. INVESTIGAÇÃO OBRIGATÓRIA

Antes de implementar qualquer alteração, mapear:

- monorepo;
- apps;
- packages;
- frontend;
- backend;
- banco;
- migrations;
- domínio;
- contratos;
- APIs;
- autenticação;
- autorização;
- usuários;
- vendedores;
- clientes;
- produtos;
- preços;
- descontos;
- pedidos;
- financeiro;
- comissão;
- Sankhya;
- integrações;
- componentes;
- design system;
- estado;
- cache;
- testes.

Não inventar tabelas, endpoints, permissões ou regras.

Localizar no código.

# 4. CLIENTES COMO CENTRAL COMERCIAL

Avaliar transformar a área de Clientes em uma central operacional.

O vendedor deverá conseguir acessar rapidamente:

- cadastro;
- situação comercial;
- histórico;
- últimas vendas;
- produtos comprados;
- informações financeiras permitidas;
- indicadores;
- pedidos recorrentes;
- último pedido.

Ações rápidas desejadas:

- Novo Pedido;
- Ficha;
- Histórico;
- Pedido Recorrente;
- Repetir Último Pedido.

# 5. FICHA 360 DO CLIENTE

Permitir consultar dados do cliente sem perder o contexto atual.

Exemplo:

Pedido aberto
→ abrir cliente
→ consultar financeiro/histórico
→ fechar
→ continuar exatamente no mesmo pedido.

Avaliar a solução apropriada entre Drawer, Sheet, Modal ou estrutura equivalente.

Possíveis áreas:

- visão geral;
- cadastro;
- financeiro;
- vendas;
- produtos;
- histórico;
- análise;
- recorrentes.

# 6. NOVO PEDIDO PELO CLIENTE

Fluxo esperado:

Clientes
→ Cliente
→ Novo Pedido
→ pedido iniciado com o cliente já preenchido.

Nunca exigir que o usuário selecione novamente um cliente que acabou de escolher.

Preservar todas as regras existentes de:

- preço;
- desconto;
- vendedor;
- fiscal;
- financeiro;
- pagamento;
- transportadora;
- autorização.

# 7. ATALHOS DE PRODUTOS

Avaliar filtros como:

- Comprados;
- Não Comprados;
- Último Pedido;
- Mais Vendidos;
- Promoções;
- Destaques.

Utilizar somente informações reais disponíveis.

# 8. REPETIR ÚLTIMO PEDIDO

É diferente de pedido recorrente.

Pedido anterior
→ copiar
→ gerar novo pedido
→ permitir edição completa.

Nunca modificar o pedido original.

# 9. PEDIDOS RECORRENTES

Pedido recorrente é um TEMPLATE associado ao cliente.

Permitir múltiplos templates por cliente quando fizer sentido.

Exemplos:

- Pedido padrão;
- Pedido mensal;
- Reposição;
- Pedido Festa.

Ao utilizar:

Template
→ Novo Pedido independente.

Depois disso o vendedor pode editar normalmente.

O novo pedido não deve permanecer dependente do template.

# 10. OPERAÇÃO EM MASSA

Pedidos com muitos produtos devem ser rápidos.

Avaliar grade editável com:

Código
Produto
Quantidade
Preço
Desconto
Total

Avaliar:

- TAB;
- ENTER;
- seleção múltipla;
- desconto em massa;
- alteração múltipla;
- remoção múltipla;
- inclusão rápida.

Preservar regras comerciais.

# 11. IMPORTAÇÃO DE PLANILHA

Permitir XLSX e/ou CSV conforme a arquitetura permitir.

Antes de implementar descobrir:

- identificador correto de produto;
- campos obrigatórios;
- unidade;
- quantidade;
- preço;
- desconto;
- validações.

Fluxo:

Selecionar arquivo
→ Ler
→ Validar
→ Preview
→ Exibir erros
→ Confirmar
→ Adicionar itens.

Nunca ignorar erro silenciosamente.

# 12. COMISSÕES

Permitir ao vendedor compreender:

- quanto vendeu;
- base da comissão;
- comissão calculada;
- pedidos envolvidos;
- clientes;
- produtos;
- período;
- status.

Descobrir a regra REAL de comissão antes de implementar.

Não aproximar cálculos.

# 13. RELATÓRIOS

Avaliar:

- vendas;
- pedidos;
- clientes;
- produtos;
- mix;
- ticket;
- evolução;
- comissão.

Filtros:

- período;
- cliente;
- produto;
- grupo;
- região;
- status.

Cada vendedor deve visualizar somente dados permitidos.

# 14. MAPA COMERCIAL

Permitir ao representante visualizar seus resultados geograficamente.

Antes de implementar identificar:

- UF;
- cidade;
- CEP;
- região;
- território;
- coordenadas existentes.

Não inventar latitude/longitude armazenada.

# 15. PERMISSÕES

A área de Integração não deve aparecer para vendedores não autorizados.

Não resolver apenas com CSS.

Verificar:

- menu;
- componente;
- rota;
- API;
- backend;
- escopo dos dados.

URL manual não deve permitir contornar autorização.

# 16. UX/UI

Direção:

- moderna;
- minimalista;
- corporativa;
- limpa;
- profissional;
- consistente;
- rápida.

Usar:

- boa hierarquia;
- espaçamento consistente;
- bordas discretas;
- ícones consistentes;
- feedback;
- skeleton;
- loading;
- empty states;
- erros claros.

Evitar:

- excesso de cards;
- cards dentro de cards;
- sombras exageradas;
- excesso de cores;
- espaços vazios gigantes;
- dashboards puramente decorativos.

# 17. MOTION

Movimento deve ter propósito.

Utilizar para:

- abrir ficha;
- abrir drawers;
- adicionar/remover produto;
- atualizar valores;
- mostrar barra contextual;
- loading;
- sucesso;
- erro;
- mudança de contexto.

Animações rápidas e discretas.

A sensação deve ser de FLUIDEZ, não de efeitos.

# 18. DESIGN SYSTEM

Antes de redesenhar telas isoladamente, verificar componentes existentes.

Avaliar padronização de:

- Button;
- Input;
- Select;
- MultiSelect;
- Search;
- DatePicker;
- Table;
- DataGrid;
- Modal;
- Drawer;
- Sheet;
- Card;
- Badge;
- Tooltip;
- Tabs;
- Toast;
- Skeleton;
- EmptyState;
- PageHeader;
- FilterBar;
- ActionBar.

Reutilizar antes de criar.

# 19. PERFORMANCE

Auditar:

- requests;
- queries;
- paginação;
- cache;
- debounce;
- N+1;
- renderizações;
- tabelas grandes;
- lazy loading;
- bundles;
- dashboards.

Não trocar uma interface antiga por uma interface bonita e lenta.

# 20. COMPATIBILIDADE

Não:

- reescrever o sistema inteiro;
- trocar framework por preferência;
- trocar banco;
- criar arquitetura paralela;
- quebrar APIs desnecessariamente;
- alterar schema sem migration;
- remover funcionalidades sem investigar;
- atualizar dependências aleatoriamente.

Evoluir incrementalmente.

# 21. PLANEJAMENTO

Depois da investigação, atualizar este documento com o plano técnico REAL.

O plano deve apresentar:

- arquitetura atual;
- fluxo atual;
- problemas encontrados;
- funcionalidades reutilizáveis;
- alterações propostas;
- frontend afetado;
- backend afetado;
- banco afetado;
- contratos afetados;
- APIs afetadas;
- permissões;
- testes necessários;
- dependências;
- riscos;
- ordem de execução.

Sugestão conceitual de fases:

A — Fundação visual / componentes
B — Clientes / Ficha 360
C — Fluxo de Pedido
D — Operação em Massa / Importação
E — Recorrentes / Repetir Pedido
F — Relatórios / Comissão
G — Mapa Comercial
H — Performance / Acessibilidade / Refinamentos

A investigação pode alterar essa ordem.

# 22. AUDITORIA DO PLANO

Antes de implementar:

usar os agentes adequados disponíveis em `.claude/agents`.

Auditar:

- arquitetura;
- regressões;
- segurança;
- permissões;
- regras comerciais;
- duplicações;
- banco;
- contratos;
- performance;
- complexidade desnecessária.

Corrigir o plano antes de implementar.

# 23. IMPLEMENTAÇÃO

Implementar por blocos pequenos.

Para cada fase:

1. identificar arquivos;
2. identificar riscos;
3. implementar;
4. lint;
5. typecheck;
6. testes;
7. build;
8. auditoria;
9. corrigir;
10. testar novamente;
11. atualizar progresso.

# 24. CRITÉRIO FINAL

Perguntar:

- exige menos cliques?
- reduz repetição?
- preserva contexto?
- diminui erros?
- está visualmente consistente?
- parece um produto da PLAC?
- motion ajuda?
- regras comerciais continuam corretas?
- permissões estão seguras?
- desempenho continua aceitável?
- testes passaram?
- auditoria terminou?

Se não, não considerar concluído.

---

# 25. PLANO TÉCNICO REAL (v1 — 2026-09-21, baseado na investigação do código)

STATUS DESTA SEÇÃO: EM AUDITORIA (Auditoria 1). Não implementar antes de fechar a auditoria.
Fontes: relatórios de investigação (frontend, backend/contratos/DB/Sankhya/decisões, 21 capturas do Vidya)
e leitura direta de `policy.ts`, `nav-items.ts`, `project-spec.md`.

## 25.1 Arquitetura atual (fatos)

- Monorepo pnpm+Turborepo: `apps/web` (Vite 8, React 19, TanStack Router/Query, Tailwind 4, lucide, radix),
  `apps/server` (NestJS 12/Fastify, API e Worker separados), `packages/{contracts,domain,db,sankhya,ui,config}`.
- Contratos: 19 rotas em `packages/contracts/src/routes.ts` (Zod → OpenAPI → cliente). Autorização por rota,
  default-deny, em `apps/server/src/iam/policy.ts` (`ROUTE_POLICY`); teste de matriz obrigatório por rota.
- Escopo de dados do vendedor aplicado em SQL (`erp_customer.seller_code`, `sales_order.seller_code`).
  Fora do escopo = 404.
- Web: design system próprio em `packages/ui` (~30 componentes, tokens `--sf-*`, CSS keyframes, sem
  framer-motion, sem dark mode). Marca atual = badge de texto "SF" + `installationName` vindo de `/config.json`.
  Nenhum logo/favicon no repo (correto: sem hardcode PLAC).
- Pedidos: somente RASCUNHOS (`draft`/`cancelled`); envio ao ERP desabilitado (409 `erp_submission_disabled`).
  Preços/totais só do servidor + `packages/domain` (decimal). Itens = `productCode` + `quantity`. Sem desconto.
- Espelho Sankhya: vendedores, clientes (sem endereço/telefone/e-mail sincronizados), produtos, tabelas e preços.
  NÃO espelhados: notas/pedidos históricos (TGFCAB/TGFITE), financeiro (TGFFIN), metas, comissão, endereço.

## 25.2 Problemas encontrados (reais)

P1. Menu mostra "Integração" a todos; o vendedor cai em 403. Servidor já nega (`getConfiguration` = admin).
    Falta filtro de menu e guard de rota no front. Além disso `/ready` autenticado devolve detalhe
    (entidades falhando, mensagem) a qualquer perfil e o pill do topo o exibe.
P2. Nada de logo/favicon/identidade; tokens com radius 3–6 px (briefing pede bordas mais arredondadas).
P3. Editor de pedido: sem teclado tipo planilha, sem seleção/remoção múltipla, sem lançamento múltiplo,
    sem importação, remoção imediata sem desfazer. Máx. 500 itens/pedido (contrato).
P4. Cliente: existe `?customer=` no editor (reutilizável), mas Clientes não tem ação "Novo pedido" por linha
    nem ficha rápida; a ficha é uma rota cheia (perde o contexto do pedido).
P5. Bundle único de ~620 kB sem code splitting; blocos "filtros ativos/limpar" duplicados em 3 telas.
P6. E2E Playwright (não commitado, tarefa pausada) depende de textos/seletores das telas atuais.

## 25.3 Restrições que limitam o escopo (NÃO inventar — CLAUDE.md §4 e CURRENT.MD "Autonomia")

R-a. Comissão: D6 (APPROVED) = calculada no Sankhya, o app só exibe; fonte R28 UNDECIDED; spike S6 NEEDS
     VALIDATION. → NÃO implementar cálculo nem tela com valores até haver fonte validada.
R-b. Desconto (item/total/em massa): P-10 aprovado só no princípio; R35/R36/R37 UNDECIDED; não há coluna
     de desconto no schema. → "Desconto em massa" e "Desconto no total" ficam BLOQUEADOS.
R-c. Histórico real de compras, último pedido do ERP, produtos comprados/não comprados, mais vendidos,
     financeiro/inadimplência, análise/engajamento do cliente: Q-02 aberta, R42 UNDECIDED, TGFCAB/TGFITE/
     TGFFIN não espelhados. → Ficha 360 mostra apenas o que existe; demais abas com estado
     "Não disponível nesta instalação" honesto (nunca 0, nunca dado inventado). Sem "Comprados/Mais
     vendidos" reais. Sem pontuação de engajamento (regra desconhecida).
R-d. Mapa: sem endereço sincronizado (city/state existem no schema mas nunca são populados), sem
     lat/long/território; P-13 exclui roteirização/GPS. → BLOQUEADO até espelho de endereço (W-13 PARTIAL)
     e histórico de vendas.
R-e. Relatórios de vendas (RF-DSH-1/4/6, Fase 2): dependem de Q-02/R42/S6. Só existiriam sobre rascunhos
     locais, sem valor comercial → BLOQUEADO; exportação exige política de permissão (AUTH-4 PROPOSED).
R-f. Não conceder permissão nova sem instrução (security.md). Novas rotas de templates/resolução de
     produto são pedidas pela tarefa; grants explícitos e testes de matriz; nenhuma rota nova para
     `getConfiguration` etc.
R-g. Sem PLAC hardcode: marca (nome, logo, favicon, cor de acento) vem da configuração de runtime da
     instalação (`/config.json` + assets servidos pela instalação), não do código da aplicação.
R-h. Logo: só existe PNG raster (2665×840, vermelho / azul / branco). Não vetorizar por conta própria
     (traçar automaticamente distorce marca). Usar o PNG como asset da instalação até o dono fornecer
     SVG/AI original. Cor reamostrada em 2026-09-22 (PowerShell + `System.Drawing`, pixel real do arquivo
     achado em `C:\Users\T-GAMER\Desktop\obs-archives\Pasted image 20260921113113.png`): vermelho
     `#FF010A`, azul-marinho `#001369` — levemente diferente do valor anotado antes (`#FF0010`/`#02165F`,
     possivelmente estimado à vista); usar os valores reamostrados. Preview local aplicado em
     `apps/web/public/config.json` (dev, sem commit): `accent: "#001369"` — vermelho reprovaria no gate de
     contraste do próprio `parseAccent()` (`brand.ts`, ≥5,5:1 com branco; vermelho dá ≈3,99:1), por isso fica
     só decorativo (logo), não accent interativo. Detalhe em `SALES_FORCE_PROGRESS.md` ("Fase A2b").

## 25.4 Reutilizável (não recriar)

Design system `packages/ui` inteiro (Button, Input, Combobox, Dialog, **Drawer**, Tabs, Toast, Skeleton,
Empty/Error/ForbiddenState, PageHeader, FilterBar, Table com setas, Pagination, StatTile, Money);
`AppShell`, `nav-items.ts`, `QueryError`, `customer-picker`, `product-picker`, `price-cell`,
`lib/order-draft.ts` (preview com domain), `use-search-box`, `search-params`, idempotência
(`clientRequestId`), `expectedVersion`, `useBlocker`; `?customer=` do editor; `POST /orders` para copiar;
`sales_order_item.product_code` indexado; pipeline vitest+Testcontainers+Playwright.

## 25.5 Fases propostas (ordem revisada pela investigação)

Ordem: 0 → B1 → A → B2 → C → D → E → H. F e G ficam bloqueadas (ver 25.3) e voltam ao dono.

### Fase 0 — Preparação (sem código de produto)
- Trabalhar no worktree existente `C:\Dev\sales-force-evolution` (branch `feat/sales-force-evolution`,
  limpo, HEAD 823eefa) para NÃO misturar com o E2E não commitado da tarefa pausada.
- `pnpm install` (mesmo lockfile), baseline: lint, typecheck, test, build. Registrar resultado.
- Commits: não commitar sem autorização do dono (CLAUDE.md §7); manter alterações no worktree e pedir
  autorização por fase.

### Fase B1 — Permissões da área Integração (item 15 do briefing) [segurança; TDD]
- Front: `nav-items` com `roles?` e filtro por `session.user.role`; guard `beforeLoad` em `/integracao`
  (redirecionar/forbidden para não-admin); `ConnectedIntegrationPill` só para admin.
- Servidor: manter `getConfiguration` admin-only (já testado). AUDITAR se `/ready` autenticado deve
  restringir detalhe a admin (endurecimento; nenhum grant novo). Se sim: contrato/teste de matriz.
- Testes: vitest (menu por perfil, guard, URL manual), matriz no servidor, E2E de URL manual.
- Arquivos: `apps/web/src/components/{nav-items.ts,app-shell.tsx,integration-pill.tsx}`, `router.tsx`,
  `apps/server/src/health/*` (se decidido), testes.

### Fase A — Fundação visual/PLAC/motion (itens 7, 10 do briefing; itens 16–18 do plano)
- Tokens: radius maior (ex.: 6/8/12), paleta neutra + acento vindo da instalação; sem cards aninhados.
- Marca por configuração: `config.json` ganha `brand {name, logoUrl, markUrl, accent}` (schema Zod no
  runtime-config); componente `Brand` único (shell + login); favicon dinâmico. Assets PLAC ficam em
  `deploy/` da instalação (não em `apps/web/src`).
- Motion CSS-only (sem framer-motion): tokens de duração/easing, entrada de drawer/dialog, linhas
  adicionadas/removidas, toasts, `prefers-reduced-motion` mantido.
- Promover componentes duplicados: `ActiveFilters` (chips + limpar), `SortableHead` genérico, `ListCard`.
- Sem nova dependência. `/_design` atualizado. Testes de componente + a11y (jsx-a11y).

### Fase B2 — Clientes como central comercial + Ficha 360 (itens 3, 4 do briefing)
- `CustomerSheet` (Drawer direito, `packages/ui`/web): abas Visão geral, Cadastro, Pedidos (rascunhos do
  cliente), Financeiro/Histórico/Análise = estado "Não disponível" (R-c). Abre por clique/tecla em Clientes,
  em Catálogo (cliente de preço) e DENTRO do editor de pedido sem perder estado (estado local, sem
  navegação; `useBlocker` não dispara).
- Ações rápidas na linha e na ficha: Novo pedido, Ver pedidos, Repetir último pedido (Fase C).
- Dados: somente contratos existentes (`getCustomer`, `listOrders`); nenhum endpoint novo.
- Cartões de resumo estilo "positivação" só se houver dado real (não há) → omitir.

### Fase C — Fluxo de pedido pelo cliente (itens 5, 8 do briefing)
- "Novo pedido" na linha de Clientes e na Ficha → `/pedidos/novo?customer=` (já existe); cliente
  travado visível com ação "trocar cliente" (com confirmação se houver itens).
- "Repetir último pedido": GET do último pedido local do cliente (rascunho/cancelado no escopo) →
  `POST /orders` novo (novo `clientRequestId`, mesmos itens; servidor recalcula preços) → abre
  `/pedidos/$id`. Original intocado. Rótulo honesto: "último pedido registrado no Sales Force" (o
  histórico do ERP não é espelhado).
- Sem mudança de contrato. Regras de preço/vendedor/escopo continuam 100% no servidor.

### Fase D — Operação em massa e importação (itens 4, 10, 11 do briefing)
- Grid: Enter/Tab entre células, foco na linha nova, seleção múltipla, remoção múltipla com "Desfazer",
  alteração múltipla de quantidade, "Lançamento múltiplo" (colar código;qtd). Desconto: BLOQUEADO (R-b).
- Importação CSV (sem dependência) e XLSX (biblioteca a auditar — NÃO usar `xlsx` do npm público por
  histórico de vulnerabilidade; avaliar `read-excel-file`/`exceljs`), parse NO NAVEGADOR (arquivo não sobe;
  limites 20 MB/50 mil linhas → recortar em 500 itens/pedido, contrato existente).
- Identificador: `code` (CODPROD) e `reference`; EAN/código do cliente AUSENTES (informar no preview).
- Novo endpoint de leitura `POST /products/resolve` (lote ≤500 identificadores, escopo de catálogo,
  Zod strict, paginação n/a) para evitar N requisições; grants para todos os perfis de sessão, com matriz.
- Preview: linhas válidas / erros por linha (não achado, ambíguo, qtd inválida, duplicado, sem preço,
  não vendável); nunca ignorar erro silencioso; confirmar → adiciona ao rascunho (validação final no servidor).
- Testes: parser (unit, mandatório), resolve (integração + matriz), UI, E2E.

### Fase E — Pedidos recorrentes (templates) (item 9 do briefing)
- Migration EXPAND-ONLY: `customer_order_template(id uuid v7, customer_code, name, created_by_account_id,
  seller_code snapshot?, version, timestamps, deleted_at)` + `customer_order_template_item(template_id,
  line_no, product_code, quantity)`. Sem preço, sem desconto (recalculado ao usar). Sem FK a `sales_order`
  (independência do pedido criado).
- Rotas: list/create/replace/delete por cliente + `useTemplate` (cria rascunho independente via mesmo
  caminho do `createOrder`, idempotente). Escopo = escopo do cliente; edição/remoção: criador, manager,
  admin (SUPOSIÇÃO a validar na auditoria — não é regra aprovada). Auditoria de ações.
- UI: aba "Recorrentes" na Ficha; salvar rascunho como template; "Usar" → novo pedido.
- Testes: TDD para autorização/escopo (matriz + IDOR), migração no Testcontainers, idempotência.

### Fase H — Performance/acessibilidade/refinamentos
- Code splitting por rota (`lazyRouteComponent`), meta de chunk inicial < 250 kB gz; medir.
- `listOrders` (subselects correlacionados) — medir antes de mudar; cache de `product-groups`.
- Revisão a11y (alvos de toque, foco no drawer, contraste). Atualizar E2E quando o E2E for retomado.

### Fases F (Comissões/Relatórios) e G (Mapa): BLOQUEADAS — perguntas ao dono
1. Comissão/metas: qual é a fonte no Sankhya (R28/S6) e há autorização para spike de leitura S6?
2. Histórico de vendas/financeiro (Q-02): autoriza incluir TGFCAB/TGFITE/TGFFIN no espelho (destrava
   Ficha completa, Comprados/Mais vendidos, relatórios, mapa)? Exige decisão + validação no Sandbox.
3. Desconto (R35/R36/R37): regras de base/alçada para liberar "Desconto no total/em massa".
4. Logo vetorial (SVG/AI) da PLAC — paleta oficial já encontrada em 2026-09-22 (raster, ver R-h); falta só
   o vetor original, se a marca precisar escalar para formatos grandes.
5. Mapa: aceitável por UF/cidade (sem coordenadas), sem contrariar P-13?

## 25.6 Riscos

- Escopo grande: 8 fases; risco de dispersão → entregar B1 e A primeiro, cada fase verificável.
- Regressão nas telas cobertas pelo E2E não commitado → atualizar seletores ao integrar.
- Templates: nova permissão/regra de edição é suposição → registrar como pendente de aprovação.
- XLSX: superfície de ataque (zip bombs, fórmulas); limitar tamanho, ler só valores, sem macros.
- "Repetir último pedido" pode enganar se confundido com histórico do ERP → rótulo honesto.
- Performance: grid 500 linhas → memo/virtualização se medir lentidão.

## 25.7 Testes exigidos por fase

Vitest (web/ui/domain), integração com Testcontainers (endpoints, migração, matriz de autorização,
IDOR), Playwright (a11y e fluxos), lint, typecheck, build; `security-reviewer` em B1, D (resolve/import)
e E (autorização/escopo/migração); `code-reviewer` ao fim de cada fase.

## 25.8 Fora de escopo confirmado

Reescrever o sistema, trocar framework/banco, atualizar dependências fora de necessidade, envio real ao
Sankhya, cálculo próprio de comissão, dados inventados de engajamento/financeiro/mapa.

---

## 25.9 PLANO v2 — correções da Auditoria 1 (SUPERSEDE §25.5 onde houver conflito)

STATUS: AUDITADO (3 revisores, APROVADO COM AJUSTES; ver SALES_FORCE_AUDIT.md). Implementação liberada
fase a fase. Fatos corrigidos: 20 rotas; `SortableHead`, `CustomerOrders` e "Novo pedido" no detalhe do
cliente JÁ existem; readiness em `apps/server/src/platform/`; `runtime-config.ts` é parse manual (sem Zod);
bundle atual 195 kB gz.

### Ordem final
0 (preparação) → B1 → A → H1 (code splitting) → B2 → C → D (CSV/colar primeiro) → E (MVP) → H2.

### Autorização de escopo (registro)
Importação, repetir pedido e pedidos recorrentes são Fase 1 no roadmap, mas foram pedidos de forma
explícita pelo dono em CURRENT.MD + briefing (precedência 1, CLAUDE.md §1). Ao iniciar D/E registrar a
antecipação em `docs/roadmap.md` (nota curta). Grants novos (resolução de produtos, templates) seguem a
suposição já registrada em `policy.ts` (EVERY_ROLE, pendente de R35/R36) — listados como PENDENTES do
dono, não como decididos.

### Fase 0 — Preparação
- Worktree `C:\Dev\sales-force-evolution`: `pnpm install --frozen-lockfile`, baseline lint/typecheck/test/
  build. E2E (não commitado) fica fora; manter os nomes acessíveis usados pelos specs
  (`Quantidade de X`, `Novo pedido`, `Salvar rascunho`).

### Fase B1 — Integração (TDD, security-reviewer)
1. `INTEGRATION_ROLES = ['admin']` em `packages/contracts` (fonte única) usado por `policy.ts`
   (`getConfiguration`) e pelo helper `canSeeIntegration(role)` no front.
2. Front: `nav-items` filtra por helper; `beforeLoad` de `/integracao` renderiza `ForbiddenState`
   (mantém a URL) para quem não pode; o pill CONTINUA para todos (estado grosso).
3. Servidor: `/ready` só devolve detalhe se a política permitir `getConfiguration` ao usuário da sessão
   (`AuthService.peekSession` somente leitura — não desliza a sessão); demais perfis recebem o estado
   grosso. Sem mudança de contrato/OpenAPI.
4. Testes: integração `/ready` (admin completo; seller/manager/anônimo grosso, sem
   `failingEntities`/`message`/`lastSuccessAt`/contagens); matriz `getConfiguration` (existente);
   vitest menu por perfil + guard + URL manual; ajustar `screens.test.tsx` (perfil admin).

### Fase A — Fundação visual (MVP)
- Tokens: radius maior + tokens de duração/easing; `Brand` único (shell+login); favicon da instalação.
- Marca por config: `brand{name,logoUrl,markUrl,accent}` em `runtime-config.ts` com parse manual
  defensivo: caminho same-origin `^/[A-Za-z0-9._/-]+$` (sem `//`, `..`, esquema), `accent`
  `^#[0-9a-fA-F]{6}$` aplicado por `style.setProperty`; inválido ⇒ padrão. Mesma validação em
  `deploy/nginx/40-runtime-config.sh`. `/brand/` no nginx com `Content-Security-Policy: sandbox;
  default-src 'none'`; CSP geral repetida em cada `location` (nginx não herda `add_header`). Ativos PLAC
  ficam na instalação (deploy), nunca em `apps/web/src`. Logo PNG usado como está (R-h).
- Motion CSS-only. SEM `ActiveFilters`/`ListCard` (só se uma tela nova precisar). `SortableHead` já existe.
- Contraste AA com o acento configurável; teste.

### Fase H1 — Code splitting por rota (antes de D)
- `lazyRouteComponent` nas telas; meta: chunk inicial ≤ 195 kB gz (não piorar), medido no build real.

### Fase B2 — Clientes/Ficha 360 (reduzida)
- Ação "Novo pedido" na linha de `customers.tsx` (≤2 cliques). `CustomerSheet` (Drawer existente) com abas
  Visão geral/Cadastro/Pedidos (reutiliza `CustomerOrders`); Financeiro/Histórico/Análise = "Não
  disponível" (R-c). Estado da Ficha vive ACIMA do remount `id:version` do editor; links internos
  desativados/nova aba dentro do editor; dirty-snapshot não inclui estado da Ficha.

### Fase C — Pedido pelo cliente
- Cliente travado + "trocar cliente" com confirmação que avisa repreço; mensagem visível quando
  `getCustomer` falha/404 (hoje silencioso).
- "Repetir último pedido": último = mais recente NÃO cancelado do cliente; copia só `productCode`+
  `quantity`; itens indisponíveis viram aviso e o resto é copiado; um `clientRequestId` por ação (sem
  duplo clique); rascunho fica com o vendedor do cliente; rótulo honesto "último pedido registrado no
  Sales Force". Original intocado.
- Atalho "Do último pedido" (mesma fonte). Comprados/Não comprados/Mais vendidos/Promoções/Destaques/
  Rupturas: fora (sem dado, R-c).

### Fase D — Massa e importação
- Enter no campo de quantidade: `preventDefault` (hoje SALVA o rascunho) + teste de regressão; Enter vai
  à próxima linha; seleção/remoção múltipla com Desfazer (memória); quantidade em massa; "Lançamento
  múltiplo" (colar `código;qtd`). Desconto: BLOQUEADO (R-b).
- Importação CSV/colar no navegador (sem dependência); limites 20 MB/50 mil linhas ANTES do parse;
  `Map`/`Object.create(null)` (sem `__proto__`); recorte em 500 itens com aviso explícito. XLSX só após
  auditoria da lib (Web Worker, limite descompactado, sem `xlsx` npm) — opcional. Desvio de RF-IMP-2
  registrado (sem mapeamento automático/segundo plano).
- `POST /product-resolutions`: `strictObject{customerCode?, identifiers[≤500, ≤40 chars]}`; match exato
  por `= ANY`; `isProductVisible` ⇒ oculto = "não achado"; ≤5 candidatos por identificador ambíguo; DTO
  `ProductListItem` (sem custo/margem); `customerCode` via `requireVisible` (404 fora do escopo);
  reutiliza o caminho de preço do `draft-builder`; body ≤64 kB; grant EVERY_ROLE (suposição pendente) +
  linha na matriz. Duplicado no arquivo: sinalizar no preview e NÃO somar em silêncio (regra pendente).

### Fase E — Recorrentes (MVP: criar, listar, usar, apagar)
- Migration expand-only: `customer_order_template` (id uuid v7 gerado no app, customer_code SEM FK,
  name ≤80, created_by_account_id, client_request_id+request_hash únicos por conta, version, timestamps,
  deleted_at; único `(customer_code, lower(name)) WHERE deleted_at IS NULL`; limite 50/cliente) e
  `customer_order_template_item` (template_id, line_no, product_code, quantity numeric(14,4); ≤500). SEM
  `seller_code`, notes, preço, desconto.
- Escopo = cliente vivo (`JOIN erp_customer`); `FOR SHARE` no cliente + `FOR UPDATE` no template na
  transação; fora do escopo = 404 idêntico. Qualquer ator no escopo lê/usa/edita/apaga.
- "Usar": regra pura no `packages/domain` + service reutiliza `createOrder` com novo `clientRequestId`
  (uma vez por ação). Auditoria (criado, substituído, apagado, usado) só com ids/contagens.
- Testes: matriz, IDOR, reatribuição de cliente, idempotência, migração (Testcontainers), produto inativo.

### Fase H2 — Performance/a11y/filtros
- Medir `listOrders` antes de mudar; filtros período/cliente/status em Pedidos; axe na Ficha e na grade.

### Critérios de aceite mensuráveis
- "Novo pedido" a partir de Clientes ≤2 cliques; "Repetir último" ≤2; usar template ≤3.
- 50 itens lançados só com teclado, sem mouse.
- CSV de 500 linhas: preview em <2 s, contagem de erros igual ao esperado.
- Chunk inicial ≤195 kB gz (build real) + rotas em lazy chunks.
- axe sem violações sérias na Ficha e na grade; nomes acessíveis dos specs E2E preservados.
- lint, typecheck, test, build verdes com saída real; security-reviewer sem bloqueante em B1, D, E.

### Perguntas ao dono (não bloqueiam B1/A/B2/C/D-CSV; bloqueiam F/G)
1. Fonte de comissão/metas (R28/S6) e autorização de spike de leitura.
2. Q-02: incluir TGFCAB/TGFITE/TGFFIN no espelho (destrava Ficha completa, Comprados, relatórios, mapa).
3. Regras de desconto (R35/R36/R37).
4. Logo vetorial SVG/AI (paleta oficial já resolvida em 2026-09-22 — raster, ver R-h e PROGRESS "Fase A2b").
5. Duplicados na importação (somar/rejeitar) e itens indisponíveis ao usar template/repetir.
6. Grants EVERY_ROLE para resolução e templates (suposição atual).

## Plano 2026-09-25 — Evolução visual PLAC (fase concluída localmente)
Ordem seguida: tokens → layout → navegação → componentes → páginas → estados → responsividade. Pendências: paleta Ctrl K e sino (decisão de escopo), stepper de etapas (dados), layout em cards para tabelas <768px, inspeção do Login, revisão do dono antes de qualquer push.

## Plano 2026-09-28 — Missão permanente: paridade Web + Mobile + Offline

**Definition of Done permanente (registrada pelo dono nesta sessão):** uma feature comercial só é COMPLETA
quando domínio + backend + contratos + web + mobile + comportamento offline (quando aplicável) + sync (quando
aplicável) + testes + QA estiverem tratados. Uma feature que só existe no Web fica PARCIAL, nunca COMPLETA.
Vale para esta e para futuras missões.

**Prioridades definidas pelo dono, nesta ordem:**
1. Desconto por item no mobile (WEB já é PASS via DISC-1) — reusar `packages/domain`/`packages/contracts` sem
   duplicar matemática.
2. Rascunho offline completo (login online → sync → offline → criar pedido → cliente local → produtos →
   quantidade → desconto → salvar rascunho local → fechar/reabrir app → reconectar → sync → backend recebe
   uma vez, sem duplicidade).
3. Paridade completa de telas/estados entre Web e Mobile (Início, Catálogo, Clientes, Ficha, Vendas+filtros,
   Novo pedido, carrinho, lançamento múltiplo, resumo financeiro, rascunhos, sessão, permissões, loading/erro/
   vazio), com UX mobile apropriada — nunca cópia do layout desktop.

Fase B (histórico Sankhya/Orçamento/Pedido ERP/Nota/mirror TGFCAB-TGFITE) segue explicitamente NÃO iniciada
até esta paridade fechar.

**Auditoria real executada antes de qualquer código** (dois agentes, achados com file:line, sem suposição):
- `apps/mobile` (branch `feat/sales-force-evolution`): Expo, sem router, login real via cookie-session, 2
  telas reais só-leitura (clientes, produtos), sem custo/margem, já importa `@salesforce/domain` e
  `@salesforce/contracts` (zero duplicação hoje), 71 testes reais passando. Sem pedido/carrinho/desconto/
  rascunho/ficha/vendas/dashboard.
- `packages/mobile-db`: stub real e honesto (47 linhas, `getLocalStorageStatus()` sempre `false`, sem schema/
  driver/criptografia/fila). Nenhum código de sync/outbox/SQLite em lugar nenhum do repo para mobile.
- `packages/domain`: livre de infraestrutura (só `decimal.js`), com checagem automatizada de fronteira
  (`scripts/check-boundaries.mjs`) que barra import de Node/DOM — já comprovadamente portável para o mobile.
- `packages/contracts`: schemas de rascunho/item/desconto/preço já modelados (`orders.ts`), agnósticos de
  runtime, prontos para reuso.

**Matriz Web × Mobile × Offline × Gap** — detalhe completo em `SALES_FORCE_PROGRESS.md` (sessão "2026-09-28 —
Diretriz permanente"). Resumo: Web = COMPLETO em praticamente tudo já entregue; Mobile = PARCIAL só em
Catálogo/Clientes (leitura) e Sessão, FALTANDO em todo o resto (Início, Ficha, Vendas, Novo pedido, carrinho,
descontos, resumo financeiro, rascunhos); Offline = FALTANDO em tudo (zero código); Integração admin = NÃO
APLICÁVEL no mobile (justificado, papel administrativo).

**Conflito de fase encontrado e resolvido com o dono (não decidido em silêncio):** `docs/roadmap.md` §3.2
exclui explicitamente "mobile features... discount/credit rules" da Fase 0, e §4 bloqueia banco local/sync
mobile no spike **S7** (nunca executado) e em **R05–R11/R16/R17/R19/R45** (UNDECIDED, `decisions.md` §5.2).
DISC-1 (a única exceção de Fase 0 já concedida) é textualmente restrita a desconto server/web e não cobre
mobile/offline. Apresentadas quatro opções ao dono; **escolhida: rodar o spike S7 primeiro**, sem nenhuma tela
de pedido/carrinho/desconto mobile e sem nenhum código de `packages/mobile-db` até o spike fechar.

**Próximo passo em andamento:** spike **S7** (biblioteca SQLite criptografada — `expo-sqlite` vs `op-sqlite` +
SQLCipher, alinhamento de 16 KB no Android, FTS5, compatibilidade segura com Drizzle, protótipo mínimo real
onde possível; performance com volume real fica pendente de dispositivo/EAS real) delegado a `mobile-engineer`,
achados em `docs/mobile-spike.md` (novo, no molde de `docs/sankhya-spike.md`). Prioridades 1–3 acima só
começam a ser codificadas depois que o spike voltar com achados e — se indicado por ele — uma nova decisão do
dono em `decisions.md` (V-09/MOB-2).
