# VIDYA_SCREEN_SPECS.md — Especificação observacional do Vidya Force

Fonte única: 17 imagens em `C:\Dev\sales-force-evolution\.claude\references\vidya\vidya-force-references\`
(14 telas/estados do Vidya Force + 3 ativos de marca PLAC). Lidas integralmente em 2026-09-23.
Instância de referência: `ssl-force.vidyacode.com.br/force/...`, rodapé "Plac | Versão: 2.1.224" (conta real da PLAC).

Regra de uso: isto é especificação por observação, não suposição. Onde a imagem não mostra um
detalhe (comportamento de hover, validação, resposta a erro, paginação real com dados, tela de
Catálogo), **não foi inventado** — ver `VIDYA_GAPS.md` § REFERENCE_INSUFFICIENT.

---

## 0. Casca / navegação (presente em todas as telas 02–14)

- Barra horizontal superior, gradiente navy → azul mais claro (esquerda mais escura).
- Esquerda: ícone "furacão" + wordmark "force" (branco).
- Centro: 4 itens de navegação — **HOME** (ícone alvo), **CATÁLOGO** (ícone lista), **CLIENTES**
  (ícone pessoas), **VENDAS** (ícone carrinho). O item ativo tem fundo branco arredondado (pill),
  texto navy em negrito; os inativos são texto branco sobre o gradiente.
- Direita: "Olá, GUSTAVO SOUSA" (branco) + avatar circular placeholder cinza + chevron para baixo
  (abre o menu do usuário, tela 03).
- Não há sidebar em nenhuma tela do Vidya observada.

## 1. Tela 09/01 — Clientes: lista principal

**Objetivo:** listar a carteira de clientes com indicadores de positivação e filtros ricos.

**Estrutura (topo → base):**
1. Navbar (§0), item "CLIENTES" ativo.
2. Faixa de 5 indicadores (cards inline, sem borda entre si): "Positivados no mês" (badge azul "M"),
   "Positivados na semana" (badge verde "S"), "Positivados hoje" (badge ciano "H"), "30 dias sem
   pedidos" (badge laranja "T"), "Nunca comprou" (badge roxo "N"). Cada um mostra um número grande à
   esquerda do rótulo. O padrão de badge circular com uma letra é reaproveitado depois na coluna
   "Vendas"/"Status" da tabela.
3. Linha de busca: input "Cliente" (texto livre) + input "Grupo" + ícone de engrenagem + botão
   circular azul (refresh) + botão quadrado roxo com "+" (novo cliente).
4. Linha de filtros (selects): Status, Vendas, Financeiro, Tipo de cliente, Região, Cidade — 6
   selects, todos com placeholder e seta de dropdown.
5. Link "Exportar" (ícone de download) alinhado à direita, acima da tabela.
6. Tabela, colunas na ordem: **Cód.**, **Nome Fantasia** (nome em azul, parece link), **Engajamento**
   (texto, "N/A" quando sem dado), **Endereço**, **CPF/CNPJ**, **Insc. Estadual** ("-" quando vazio),
   **Cidade - UF**, **Região**, **Status** (badge circular com letra, ex. "A" navy = Ativo),
   **Vendas** (badge circular com letra, ex. "N" roxo = Nunca comprou), **Financeiro** (dois ícones
   de ação: carrinho roxo = nova venda; impressora azul = imprimir/relatório). A tabela tem rolagem
   horizontal (scrollbar visível na base) — mais colunas do que cabem na viewport.
7. Rodapé de paginação: "Linhas por página: 20 ▾" + "1–1 de 1" + setas prev/next.

**Estados observados:** lista com 1 resultado; nenhum estado vazio/erro capturado.

**Dependência de dados:** indicadores de positivação (M/S/H/T/N) exigem uma regra de positivação —
ver `dashboard.service.ts` grupo `positivation`, hoje `value: null` ("regra ainda não definida").

## 2. Tela 02 — Vendas: lista

**Objetivo:** listar documentos comerciais (Nota, Orçamento, Pedido de Venda) com indicadores por tipo.

**Estrutura:**
1. Navbar, "VENDAS" ativo.
2. 3 cards de indicadores lado a lado, um por **tipo de documento**: "Nota", "Orçamento", "Pedido De
   Venda". Cada card mostra: Pendentes (contagem + R$), "[Tipo] Médio Dia" (R$), "Mês Anterior" (R$ +
   variação %), "Ticket Médio" (R$), Confirmados (contagem + R$).
3. Barra de abas-filtro por tipo: **TODOS** (verde, ativo) / **ORÇAMENTO** / **PEDIDO DE VENDA** /
   **NOTA** — pills horizontais.
4. À direita da barra de abas: "Total: 0,00", ícone de engrenagem, botão azul "Importar Planilha",
   botão roxo quadrado "+".
5. Linha de filtros: Nº do pedido (busca), Nº da nota (busca), Nº O.C. (busca), Programação (date
   picker), Período (select, default "90 Dias"), Status (select), Empresa (select).
6. Segunda linha: "Cliente" (busca, placeholder "TODOS") + botão azul "FILTRAR" (ícone funil).
7. Chips de filtro ativo: "LIMPAR FILTROS" (com X) + "PERIODO: 90 DIAS".
8. Tabela, colunas: **Pedido** (com seta de ordenação), **Nota**, **Cliente**, **Empresa**, **Data**,
   **Tipo de Negociação**, **Tipo de Operação**, **Observação**.
9. Estado vazio observado: "Nenhuma linha" centralizado, sem paginação visível (0 resultados).

**Dependência de dados/regra:** distinção Nota / Orçamento / Pedido de Venda como **tipos de
documento diferentes** (não apenas status de um mesmo pedido) é um conceito de domínio que o Sales
Force atual não tem (`OrderStatus` é draft/outro, um único tipo "pedido").

## 3. Tela 03 — Menu do usuário

**Objetivo:** ações de conta, acessível pelo avatar da navbar.

**Estrutura:** dropdown abaixo do avatar, alinhado à direita, fundo branco, sombra. Itens, em ordem,
cada um com ícone à esquerda:
1. Alterar foto (ícone imagem)
2. Trocar senha (ícone cadeado)
3. Servidor (ícone servidor/camadas)
4. Relatórios (ícone documento)
5. Sincronizar (ícone refresh circular)
6. **Sair** (ícone seta de saída, texto em vermelho — visualmente distinto dos demais)
Rodapé do menu, texto cinza pequeno: "Plac | Versão: 2.1.224".

## 4. Tela 04 — Seletor de cliente (modal)

**Objetivo:** escolher o cliente de um pedido sem um combobox de texto único.

**Estrutura:** modal centralizado sobre a tela de origem (fundo escurecido).
1. Input de busca "Cliente" com ícone de lupa, no topo do modal, sozinho em sua própria "barra".
2. Abaixo, lista de resultados em formato de **card** (não linhas de tabela): cada card tem
   - cabeçalho: "**{código} – {RAZÃO SOCIAL EM MAIÚSCULAS}**" (código + nome como título do card);
   - avatar circular com iniciais (2 letras, ex. "SD") à esquerda;
   - grade 2 colunas de pares rótulo/valor: **Razão Social** / **CPF / CNPJ**, **Insc. Estadual /
     Identidade** / **CIDADE**.
3. Não há paginação nem filtros adicionais visíveis no modal (só o campo de busca no topo).

**Regra absoluta aplicável:** este é exatamente o padrão a reproduzir no lugar do combobox atual —
não usar dropdown de texto.

## 5. Tela 05 — Nova venda

**Objetivo:** tela central da operação comercial: montar um pedido/nota/orçamento para um cliente.

**Estrutura (topo → base):**
1. Navbar, "VENDAS" ativo.
2. **Barra de contexto do cliente** (fixa logo abaixo da navbar, fundo branco, sem scroll):
   - esquerda: "Cliente: {código} – {NOME}" (negrito, nome parece link azul) e, abaixo,
     "Classificação Fiscal: {valor}" (ex. "Revendedor");
   - centro-direita, 3 blocos de rótulo/valor lado a lado: "Tip. Neg. mais usada" (ex. "11 – A
     VISTA"), "Crédito total" (R$), "Crédito mensal" (R$);
   - badge de status pill colorido (ex. roxo "Nunca Comprou");
   - botão "**FICHA DO CLIENTE**" (preenchido em magenta/rosa, ícone de pessoa), extrema direita —
     abre o modal de Ficha do Cliente (telas 06–08) sem sair da Nova Venda.
3. **Card "Dados do pedido"** (grid, 2 linhas × 3 colunas):
   - linha 1: Nro. Único (texto), Dt. Neg. (date picker, valor default = data atual), Tipo Operação*
     (select obrigatório);
   - linha 2: Empresa (select, ex. "1 - PLAC INDUSTRIA E COMERCIO DE..."), Tipo Negociação* (select
     obrigatório), Observação (texto livre);
   - linha 3: Parceiro Transportadora (select), Expedição (select).
4. **Barra de busca de produto:** input "Procurar Produto..." (com ícone de lupa) + select
   "Pesquisar por" (default "Todos") + select "Grupo".
5. **Linha de filtros rápidos** (checkboxes, todos na mesma linha): ☐ Destaque (com ícone de
   estrela), ☐ Promoção, ☐ Comprados, ☐ Não Comprados, ☐ Último Pedido, ☐ Mais Vendidos, ☐ Rupturas
   — 7 filtros, todos desmarcados por padrão.
6. **Alternância de visão** (pills): "**Produtos**" (verde, ativo, ícone de caixa) / "**Carrinho**"
   (inativo, ícone de carrinho) — alterna o conteúdo da tabela abaixo sem sair da tela.
7. À direita da alternância: "Desconto no Total" e "Lançamento Múltiplo" (links/pills de texto,
   parecem ações, não navegação), ícone de refresh, ícone de engrenagem.
8. **Tabela de produtos** (visão "Produtos"), colunas observadas antes do corte horizontal: **Cód.**,
   **Descrição** (com miniatura de imagem do produto), **Promoção**, **Campanha**, **Vlr. Ult.
   Com...** (valor da última compra, truncado), **Unidade**, **Quantidade** (input), **Valor
   Tabela**, **Des[conto]** (coluna cortada na captura — existência confirmada, conteúdo não visível:
   ver `REFERENCE_INSUFFICIENT`).
9. **Rodapé fixo** (barra inferior, sempre visível, não rola com a página): "Total: R$ {valor}"
   (verde), "Peso Bruto: {valor} kg", "Peso Líquido: {valor} kg", botão texto vermelho "✕ Descartar",
   botão contornado "Salvar e Sair", botão preenchido azul "✓ Confirmar".

**Dependências de dados:** Tip. Neg. mais usada, Crédito total/mensal, Classificação Fiscal, Peso
Bruto/Líquido por produto, Promoção/Campanha/Vlr. Ult. Comprado por linha — nenhum desses campos
existe hoje no contrato de pedido/produto do Sales Force (ver `VIDYA_GAPS.md`).

## 6. Tela 06 — Ficha do Cliente: aba Vendas

**Objetivo:** histórico comercial do cliente, dentro do modal de Ficha, sem sair da Nova Venda.

**Estrutura:** modal grande (ocupa a maior parte da viewport), X de fechar no canto superior direito.
1. **5 abas** no topo do modal, com ícone + rótulo, sublinhado magenta na ativa: **DADOS
   CADASTRAIS**, **FINANCEIRO**, **ANÁLISE DO CLIENTE**, **ENGAJAMENTO**, **VENDAS**.
2. Conteúdo da aba Vendas reaproveita a mesma estrutura da tela 02 (Vendas, lista geral), mas
   escopada ao cliente: abas TODOS/ORÇAMENTO/PEDIDO DE VENDA/NOTA, "Total: 0,00", botão "Importar
   Planilha", filtros (Nº pedido, Nº nota, Nº O.C., Programação, Período "Hoje", Status, Empresa),
   "FILTRAR", chips "LIMPAR FILTROS"/"PERIODO: 90 DIAS", tabela com mesmas colunas de 02, paginação
   "Linhas por página: 10 ▾", "0–0 de 0".

**Nota:** "ANÁLISE DO CLIENTE" nunca foi aberta nas capturas fornecidas — conteúdo dessa aba é
`REFERENCE_INSUFFICIENT`.

## 7. Tela 07 — Ficha do Cliente: aba Dados Cadastrais

**Estrutura (dentro do mesmo modal/abas de 06):**
1. Seção "Dados cadastrais" — grid de 4 colunas × 2 linhas, cada campo com ícone + rótulo + valor:
   Razão Social, Nome Fantasia, CPF/CNPJ, Telefone / E-mail, E-mail para envio de NF, Vendedor
   preferencial (código + nome), Tabela de preço / Classificação ICMS (ex. "Revendedor").
2. Seção "Tabela de preço" (repetida como bloco próprio, mesmo valor da grade acima) — provavelmente
   uma seção separada por design, não duplicação de dado por engano.
3. Seção com 3 cards lado a lado: **Endereço Principal**, **Endereço de Entrega**, **Endereço de
   Cobrança** (conteúdo cortado na captura — rolagem vertical do modal continua abaixo do que foi
   capturado; nomes de campo dentro de cada endereço são `REFERENCE_INSUFFICIENT`).

## 8. Tela 08 — Ficha do Cliente: aba Financeiro

**Estrutura:**
1. Seção "**Limite de crédito**" — 3 blocos lado a lado, cada um com 2 pares rótulo/valor:
   - bloco 1: Limite de Crédito (R$) / Limite de Crédito Mensal ("-" quando sem valor);
   - bloco 2: Bloqueado (Não/Sim) / Situação (ex. "Bom");
   - bloco 3: Mais usado ("Sem dados" quando vazio) / Atraso médio ("Desconhecido" quando vazio).
2. Seção "**Títulos em abertos**" (grafia observada, manter como está no rótulo se for replicado
   literalmente, mas preferir "Títulos em aberto" corrigido no equivalente próprio — decisão de
   copy, não vinculante):
   - filtros: Número do Pedido, Número do Título, Status (select), botão "LIMPAR";
   - tabela: **Ped.**, **Nº...** (truncado), **Vendedor**, **Parcela**, **Status**, **Dt. Pagamento**,
     **Tipo**, **Data Vencimento** (com seta de ordenação), **Valor**;
   - paginação "Linhas por página: 5 ▾", "0–0 de 0".
   - estado vazio observado: "Nenhuma linha".

**Dependência de dados:** todos os campos financeiros (limite de crédito mensal, bloqueado,
situação, mais usado, atraso médio, títulos em aberto) exigem dados de crédito/títulos que não
existem no `CustomerDetail` atual (só há `creditLimit`, condicional à configuração) nem no grupo
`credit` do dashboard (hoje `value: null`, "regras de crédito ainda não foram definidas").

## 9. Tela 10 — Performance (Home): Performance Comercial, topo

**Objetivo:** tela inicial (Home) do vendedor, orientada a desempenho, não a uma lista de KPIs
operacionais.

**Estrutura:**
1. Navbar, "HOME" ativo.
2. Card "**Mural de Comunicação**" — título + área de conteúdo; estado vazio observado: "Nenhum
   comunicado encontrado."
3. Abas: **Performance Comercial** (ativa, sublinhado magenta) / **Engajamento Cliente**.
4. Sob as abas: seletor de mês (date picker, ex. "setembro 2026"), select "Parcial"/outro modo,
   ícone refresh, botão de alternância de visualização (ícone de gráfico de barras, ativo/roxo).
5. Card "Ranking" (canto superior direito da seção), com um chip numérico "1" (paginação de ranking).
6. Card "**Performance**": ilustração (pessoa estressada), texto "**{0.00%}** e está em **{BAIXA}**
   performance.", "Referência: {data início} até {data fim}".
7. Card "**Ranking**" (mini, ao lado do card Performance): avatar circular com iniciais, "{NOME} está
   em **{1º}** lugar no ranking de vendas".
8. Card "Ranking" grande (coluna direita): anel de progresso circular (verde) ao redor de um avatar
   com iniciais, badge de posição ("1º") sobreposto, nome abaixo, valor percentual abaixo do nome.

## 10. Tela 11 — Performance Comercial: gráficos (rolagem)

**Estrutura (abaixo da tela 10, mesma aba):**
1. Card com ilustração "pasta com interrogação" + texto "Nenhuma métrica encontrada" (estado vazio de
   algum bloco de métricas não identificado — `REFERENCE_INSUFFICIENT` quanto ao que ele mostraria
   preenchido).
2. Card "**Peformance Mês a Mês**" (grafia observada sem "r" — manter como copy do Vidya é opcional,
   não vinculante): gráfico de linha, eixo X = meses (ex. junho/julho/agosto), eixo Y numérico
   (0–20), pontos com rótulo de valor; ícones de zoom (+/−) e um ícone de "hambúrguer"/legenda no
   canto superior do card.
3. Card "**Peformance Acumulada**": gauge circular (donut) parcialmente preenchido (roxo), texto
   central "Total {6.67%}".

## 11. Tela 12 — Engajamento Cliente, topo

**Estrutura:** mesma casca da tela 10, aba "Engajamento Cliente" ativa.
1. Sub-filtros: select "Vendedor" (ex. "76 - GUSTAVO ..."), select "Cliente", date picker de mês.
2. Ícone refresh + botão de alternância de gráfico (mesmo padrão da tela 10).
3. Card "Ranking" (canto superior direito), chip "1".
4. Card "**Engajamento**": "A carteira de clientes fez **{0.00%}** e está em **{BAIXO}** índice de
   engajamento.", "Referência: {mês}".
5. Card "Ranking" (mini): avatar genérico, "está em **{0º}** lugar no ranking de vendas".
6. Card "Ranking" grande (coluna direita): aqui a barra é **retangular/pill** (não círculo como na
   Performance Comercial) — variação de layout por aba a preservar, não um erro a corrigir.

## 12. Telas 13/14 — Engajamento Cliente: Classificação da carteira

**Estrutura (mesmo card, ambas as capturas mostram o mesmo conteúdo):**
1. Ilustração de medalha (fita azul/vermelha, medalha dourada com estrela) à esquerda do título
   "Classificação".
2. 4 grupos de contagem, cada um "**{N}**" + nome da categoria + "**{N} clientes**", nesta ordem da
   esquerda para a direita: **Ferro**, **Ouro**, **Prata**, **Bronze** — atenção: a ordem visual não é
   a ordem crescente/decrescente do intervalo numérico (ver legenda abaixo); reproduzir exatamente
   esta ordem de exibição.
3. Abaixo de cada grupo, uma coluna com a lista de clientes daquela faixa; estado vazio observado em
   todas: "Nenhum cliente encontrado".
4. **Legenda no rodapé do card**, com marcador colorido por categoria e o intervalo:
   - Ferro — 0 a 25
   - Ouro — 75 a 100
   - Prata — 50 a 75
   - Bronze — 25 a 50

   (Ordem da legenda igual à ordem dos grupos acima: Ferro, Ouro, Prata, Bronze — não é ordem
   numérica ascendente. Reproduzir literalmente; não "corrigir" para 0–25/25–50/50–75/75–100.)

## 13. Ativos de marca PLAC (imagens 15–17)

- `17-logo-plac-completo.png`: wordmark "PLAC" em navy com contorno branco, sobre fundo vermelho
  arredondado; o "P" tem um furo circular vermelho (vazado, mostrando o fundo). Cores compatíveis com
  os tokens atuais do app (`#FF010A` vermelho / `#001369` navy).
- `16-simbolo-plac-p.png`: apenas o símbolo "P" isolado (mesmo tratamento visual).
- `15-logo-plac-recorte.png`: recorte/variação de aplicação do logotipo.
- **Regra de marca:** usar esses ativos/tokens próprios da PLAC; nunca o logotipo "force"/Vidya, nunca
  a paleta azul-navy-gradiente da navbar do Vidya como identidade — a estrutura (navbar horizontal,
  abas, pills) é replicada; a pele visual (cores, tipografia, logotipo) é PLAC.

## 14. Catálogo

Nenhuma captura de tela do Catálogo Vidya foi fornecida. Registrado em `VIDYA_GAPS.md` como
`REFERENCE_INSUFFICIENT` — não inventar layout; manter a implementação atual até que uma referência
seja fornecida.
