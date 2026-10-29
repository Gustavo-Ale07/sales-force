# VIDYA_GAPS.md — Lacunas por camada

Complementa `VIDYA_PARITY.md`. Aqui os itens são agrupados por **camada responsável** (o que precisa
mudar e onde), não por tela — para orientar quem vai implementar cada bloco.

Classificação: `AVAILABLE` (dado/rota já existe, só falta UI) · `PARTIAL` (existe algo, incompleto) ·
`MISSING` (não existe, mas é implementável sem decisão de negócio nova) ·
`BLOCKED_BY_BUSINESS_RULE` (precisa de decisão do owner/`decisions.md` antes de codar) ·
`REFERENCE_INSUFFICIENT` (a imagem de referência não cobre o suficiente para implementar sem inventar).

---

## 1. Somente frontend (dado já existe no backend/contrato; falta só UI)

- **Shell horizontal** (navbar em vez de sidebar) — `MISSING`, mudança de componente
  (`app-shell.tsx`, `nav-items.ts`). Autorizada explicitamente pela missão ("A sidebar atual NÃO deve
  ser tratada como requisito").
- **Seletor de cliente em modal com cards** — ~~`MISSING`~~ FEITO (`bc4737b`, 2026-09-24; ver §6). Dado já vem de `customersQueryOptions`; só
  muda a apresentação (`customer-picker.tsx` → novo `CustomerSelectorModal`).
- **Alternância Produtos/Carrinho na Nova Venda** — `MISSING`, puramente estrutural sobre o estado
  `lines` que já existe em `order-editor.tsx`.
- **Reposicionamento do "Lançamento Múltiplo"** — `AVAILABLE`, a função já existe
  (`BulkEntryDialog`); é só um reskin/reposicionamento visual.
- **Rodapé fixo (sticky) da Nova Venda para Total + ações** — `MISSING` (CSS/layout), o valor de
  Total já é calculado (`preview.totals`); só falta Peso Bruto/Líquido (ver §3, dado ausente).
- **Menu do usuário: reordenar/estilizar itens existentes (Sair)** — `AVAILABLE`. Os outros 5 itens
  (Alterar foto, Trocar senha, Servidor, Relatórios, Sincronizar) são `MISSING` no backend — ver §2.
- **Ficha do Cliente como modal com 5 abas (casca de navegação por abas)** — `MISSING` na
  arquitetura, mas os dados da aba "Dados Cadastrais" e "Vendas" já existem parcialmente (ver abaixo);
  construir a casca de abas não depende de nenhuma decisão de negócio.

## 2. Backend a construir (rota/endpoint novo, sem depender de regra de negócio nova)

- **Trocar senha** — endpoint provavelmente já existe (auth) ou é trivial de adicionar; confirmar
  antes de assumir `MISSING`.
- **Alterar foto de perfil** — `MISSING`. Precisa de armazenamento de blob (P-17: objeto em storage,
  metadado em Postgres) — viável sem nova decisão de negócio, mas é feature nova.
- **Servidor** (tela de configuração de servidor/ambiente) — `REFERENCE_INSUFFICIENT`: a captura
  mostra só o item de menu, não a tela que ele abre.
- **Relatórios** — `REFERENCE_INSUFFICIENT`, mesma razão.
- **Sincronizar** (ação manual de sync) — depende do protocolo de sync (`sync-protocol.md`), hoje
  majoritariamente PROPOSED; não implementar como endpoint real antes de o protocolo avançar. Marcar
  como `BLOCKED_BY_BUSINESS_RULE`/dependência arquitetural, não como simples "falta UI".
- **Exportar lista de clientes** — `MISSING`, funcionalidade nova sem endpoint hoje.
- **Importar Planilha (Vendas)** — `MISSING`, funcionalidade nova sem endpoint hoje.
- **Histórico de vendas dentro da Ficha do Cliente com filtros completos e paginação** —
  `AVAILABLE`: a API de pedidos (`ordersQueryOptions`) já suporta paginação e pode ser filtrada por
  `customerCode`; é reaproveitamento, não endpoint novo.

## 3. Dado ausente no mirror/domínio (precisa confirmar existência no Sankhya antes de expor)

Estes campos aparecem nas referências mas não existem em nenhum schema hoje
(`packages/contracts/src/customers.ts`, `orders.ts`, `dashboard.ts`). Antes de implementar UI para
eles, confirmar em `docs/sankhya-spike.md` se o dado é sequer mirrável:

- Cliente: Telefone, E-mail, E-mail para envio de NF, Classificação ICMS, Endereço Principal/Entrega/
  Cobrança (3 endereços distintos), Grupo, Região.
- Produto/linha de pedido: Peso Bruto, Peso Líquido, imagem/miniatura, Promoção, Campanha, Valor da
  Última Compra do cliente para aquele produto.
- Pedido: Nro. Único, Tipo Operação, Empresa (multi-empresa), Parceiro Transportadora, Expedição.
- Vendedor: "Tipo de negociação mais usada" (agregação histórica por cliente).

**Classificação:** `MISSING` de dado, não de regra de negócio — em princípio um mirror novo resolve,
mas cada um precisa entrar no roadmap de spike Sankhya (S0–S6) antes de ganhar contrato/endpoint.

## 4. Bloqueado por regra de negócio não definida (`BLOCKED_BY_BUSINESS_RULE`)

- **Positivação da carteira** (KPIs "Positivados no mês/semana/hoje", "30 dias sem pedidos", "Nunca
  comprou", coluna "Vendas" com badge, e toda a aba/tela de Engajamento) — grupo `positivation` do
  dashboard já existe no contrato mas retorna `value: null` com a nota explícita "A regra de
  positivação ainda não foi definida" (`dashboard.service.ts:105-117`). **Nenhuma UI de positivação
  deve ser construída antes desta decisão.**
- **Crédito** (Limite de Crédito Mensal, Bloqueado, Situação, Mais usado, Atraso médio, Crédito
  total/mensal na barra de contexto da Nova Venda) — grupo `credit` do dashboard também com
  `value: null`, "As regras de crédito ainda não foram definidas" (`dashboard.service.ts:92-104`).
  Alinhado com P-10 (alçada de desconto) e P-07 (crédito revalidado no servidor) ainda UNDECIDED em
  parte (R35/R36).
- **Desconto no Total (Nova Venda)** — o próprio `order-editor.tsx` já documenta a ausência
  explicitamente ("Desconto, condição de pagamento e análise de crédito ainda não estão disponíveis
  nesta versão"). Bloqueado por P-10 (base e roteamento da alçada de desconto UNDECIDED).
- **Performance/Ranking do vendedor** (% de performance, posição no ranking, gráficos mês a
  mês/acumulada) — nenhuma regra de cálculo de performance existe; não inventar uma fórmula.
- **Classificação da carteira (Ferro/Ouro/Prata/Bronze)** — depende da mesma base de
  positivação/engajamento acima; os intervalos (0–25/75–100/50–75/25–50) já estão documentados em
  `VIDYA_SCREEN_SPECS.md` §12 para quando a regra for aprovada, mas isso é *observação do Vidya*, não
  uma regra aprovada para o Sales Force — precisa virar decisão em `decisions.md` antes de virar
  código.
- **Tipos de documento comercial (Nota / Orçamento / Pedido de Venda)** — o domínio atual de pedido
  (`OrderStatus`) não modela três tipos de documento distintos com KPIs e numeração próprios; isso é
  uma decisão de modelo de domínio (`packages/domain`), não uma tela nova. Não implementar por conta
  própria.
- **Mural de Comunicação** — nenhuma entidade de aviso/comunicado existe; decidir se isso é
  informação vinda do Sankhya, de um CMS interno ou de configuração manual antes de desenhar o
  backend.

## 3b. Nota — Seletor de cliente (2026-09-24)

Os cards do seletor omitem **Insc. Estadual** e **Cidade** (presentes no Vidya): `CustomerListItem` não os expõe. Precisam de confirmação no mirror/Sankhya antes de entrar no contrato.

## 3c. Nota — Ficha do Cliente (2026-09-24)

Aba Dados cadastrais sem Telefone, E-mail, E-mail NF, Classificação ICMS e endereços (principal/entrega/cobrança): `CustomerDetail` não os expõe (confirmar no mirror Sankhya). Financeiro mostra só o limite (condicional); situação/atraso/mais usado/títulos = BLOCKED (§4). Análise e Engajamento = placeholders documentados. Vendas: lista paginada simples; filtros completos, abas de tipo de documento e importação ficam para o bloco VENDAS DA FICHA / PÁGINA VENDAS.

## 5. `REFERENCE_INSUFFICIENT` (referência visual não fornecida ou incompleta)

- **Catálogo** (tela inteira) — nenhuma captura fornecida. Não inventar; manter a implementação atual
  de `/produtos` até receber referência.
- **Aba "Análise do Cliente"** da Ficha do Cliente — nunca aberta nas capturas.
- **Coluna "Desconto" da tabela de produtos da Nova Venda** — coluna cortada horizontalmente na
  captura (05); existência confirmada, conteúdo/formato não.
- **Conteúdo completo dos 3 cards de endereço** (Principal/Entrega/Cobrança) na aba Dados Cadastrais —
  captura cortada verticalmente (07); só os títulos dos cards são visíveis.
- **Tela "Servidor"** e **tela "Relatórios"** (abertas a partir do menu do usuário) — só o item de
  menu foi fotografado, não o conteúdo.
- **Ação "Sincronizar"** — comportamento não fotografado (o que ela sincroniza, feedback visual).
- **Card "Nenhuma métrica encontrada"** (tela 11, Performance Comercial) — estado vazio fotografado;
  o que aparece quando preenchido não foi capturado.
- **Filtros "Grupo", "Vendas", "Financeiro", "Tipo de cliente" da lista de Clientes** — o *rótulo* do
  filtro é visível, as *opções* dentro de cada select não foram capturadas (dropdown nunca aberto).

## 6. Já em paridade ou sem ação necessária

- **Paleta de marca** (`#FF010A` / `#001369`) — compatível com os ativos PLAC (15–17); nenhuma ação.
- **Lançamento Múltiplo** — função equivalente já implementada (`BulkEntryDialog`); só reskin.
- **Histórico de pedidos por cliente (versão simples)** — já existe (`CustomerOrders` em
  `customer-detail.tsx`), será absorvido pela aba "Vendas" da nova Ficha do Cliente.
- **Preço de lista, revisão de preço, idempotência de criação de pedido** — já implementados e não
  fazem parte do escopo de paridade visual (são regras de negócio já aprovadas, P-08/P-09).

---

## Como este documento deve ser mantido

- Ao fechar cada bloco da ordem de implementação (`VIDYA_PARITY.md`, seção final), mover os itens
  resolvidos daqui para "§6. Já em paridade" com a evidência (arquivo:linha) da implementação.
- Nunca promover um item de `BLOCKED_BY_BUSINESS_RULE` para implementação sem uma entrada correspondente
  em `docs/decisions.md` (owner do repositório principal, não este worktree).
- Nunca remover uma entrada de `REFERENCE_INSUFFICIENT` sem uma nova referência visual anexada e
  citada aqui.

## 3d. Produtos | Carrinho (2026-09-24, `f963a3b`)

- Feito: toggle Produtos | Carrinho (N), tabela de produtos com busca + filtro Grupo (servidor, tabela do cliente), quantidade por linha (Enter/botão), "No carrinho: N" na linha já adicionada, Lançamento múltiplo como pill.
- Sem fonte de dados / regra (não implementado, não inventado): filtros rápidos Destaque, Promoção, Comprados, Não Comprados, Último Pedido, Mais Vendidos, Rupturas; colunas Imagem, Promoção, Campanha, Vlr. Últ. Comprado, Desconto (P-10).
- Diferença deliberada: a quantidade digitada na tabela é aplicada ao clicar Adicionar/Enter (não edita o carrinho ao vivo); o carrinho é editado na visão Carrinho.
- `ProductPicker` (combobox) deixou de ser usado no editor de pedido; continua no editor de modelos (`order-template-edit-dialog.tsx`).

## 3e. Página Vendas (2026-09-24, `af28eb0`)

- Feito: título Vendas, busca por nº/cliente, filtro Cliente (seletor modal), Situação, coluna Data.
- Sem fonte de dados / regra (não implementado): abas TODOS/ORÇAMENTO/PEDIDO DE VENDA/NOTA e KPIs por tipo (tipos de documento BLOCKED), Nº nota, Nº O.C., Programação, Período (contrato `OrdersQuery` sem data), Empresa, colunas Tipo de Negociação/Tipo de Operação/Observação, Importar Planilha.

## 3f. Página Clientes (2026-09-24)

- Feito: título Clientes; busca, Situação, Vendedor, Tabela de preço, Novo pedido por linha.
- Sem fonte de dados / regra: faixa de positivação (BLOCKED), filtros Grupo/Vendas/Financeiro/Tipo de cliente/Região/Cidade, colunas Engajamento/Endereço/Insc. Estadual/Cidade-UF/Região/Vendas/Financeiro, Exportar (P-20), botão Novo cliente (fluxo lead → prospect fora da fase atual).

## 3g. Engajamento, Performance, Home, Catálogo, menu do usuário (2026-09-24)

- BLOCKED (regra indefinida): Engajamento (classificação Ferro/Ouro/Prata/Bronze, índice), Performance Comercial (percentual, ranking, mês a mês, acumulada), Mural de Comunicação, positivação.
- REFERENCE_INSUFFICIENT: Catálogo, aba Análise do Cliente, bloco "Nenhuma métrica encontrada".
- Menu do usuário: Alterar foto (sem armazenamento/endpoint), Trocar senha (fluxo de segurança, exige decisão), Servidor, Relatórios (exportação restrita, P-20), Sincronizar (sync é do mobile), rodapé "Versão" (sem fonte). Só "Sair" existe.
