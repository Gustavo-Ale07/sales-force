# Matriz de paridade SITE x APP

Arquivo vivo exigido pela PAR-1 (`docs/decisions.md` §3.21, APPROVED 2026-11-24).

## Regra (PAR-1)

Todo comportamento de pedido, desconto, status, foto, cliente e aparência decidido pelo dono vale para o SITE e para o APP. Nenhuma mudança entra só em um dos lados. Onde o app depende do aparelho (base offline, "Salvo no aparelho", sincronização), o site tem o equivalente adequado (por exemplo, salvar no servidor), mas a regra e o resultado visível ao usuário são os mesmos. Todo prompt futuro e toda revisão checa a paridade.

## Como atualizar

- Cada lote atualiza as linhas afetadas **antes do commit** do lote (Situação e SHA).
- Item novo ou diferença descoberta: incluir a linha, mesmo que ainda sem lote.
- Item que só existe de um lado por natureza vai também para a seção final, com o motivo.
- Revisão de código checa esta matriz contra o diff.

Legenda. **Igual?**: sim / só site por natureza / só app por natureza / limitação técnica. **Esforço**: P / M / G. **Servidor?**: sim se exige mudança no servidor. **Situação**: feito / parcial / não iniciado.

Lotes (definidos pelo dono): 1 e 2 em andamento hoje; 3 e 4 NÃO iniciar; FORA = fora de escopo.

## Lote 0 (primeiro item de amanhã, prioridade do dono 24/11)

| Item | Descrição | Servidor? | Situação |
|---|---|---|---|
| Pedidos do servidor no app | O sync traz para o aparelho TODOS os pedidos da mesma conta (feitos no site ou em outro aparelho) e mescla na lista local. Usa o nome do cliente que vem no pedido. "Precisa de correção" e "Verificando envio" caem em "Não enviados"; o restante em "Enviados". Mostrar o mesmo texto de erro de "Precisa de correção" nos dois lados. Inclui schema do mobile-db, sync e testes. Causa hoje: a lista do app lê só o banco local (pedidos criados no aparelho); o sync só atualiza o status dos ids já locais. | Sim (sync) | Não iniciado |

## Vendas e pedidos

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Tela cheia de atualização de dados | feito | existe | sim | M | não | 1 | feito | da6d982 |
| Presets de data em Vendas | feito | existe | sim | P | não | 1 | feito | dc9e370 |
| Abas Não enviados / Enviados em Vendas | feito (group no servidor) | existe | sim | M | sim | 1 | feito | 22506c0, 3bcfe71 |
| "Continuar o pedido em andamento?" | feito | existe | sim | P | não | 1 | feito | f0cd036 |
| Filtro de Venda | existe | inócuo: o servidor só entrega produtos vendáveis ao aparelho | limitação técnica | M | não | 2 | não entregue (não se aplica) | |
| Aviso de origem do preço na lista | existe | só no detalhe do produto; a lista local não carrega o `priceContext` | não (a igualar) | M | não | 2 | não entregue | bc5e5e8 (detalhe) |
| Filtro de pedidos por produto | existe | feito | sim | M | não | 2 | feito | 3a44ff1, 4595ffc |
| Datas por atualização ("Período por") | existe | feito | sim | P | não | 2 | feito | 3a44ff1, 4595ffc |
| Ordem/estrutura do filtro de situação | divergente | divergente | não (a igualar) | P | não | 2 | não iniciado | |
| Rótulos e controle de quantidade | feito | já igual | sim | P | não | 2ª rodada | feito | 3ddf4c7 |
| Pedido "Precisa de correção" editável (servidor) | editável | editável após sync | sim | M | sim | 2ª rodada | feito | 2d45839, c9e002e |
| "Precisa de correção" editável (site) | editável; com nº Sankhya fica só leitura (SNK-4) | | sim | M | não | 2ª rodada | feito | 41206cc, 0663f5f |
| "Precisa de correção" editável (app) | | editável só sem nº Sankhya (SNK-4) | sim | P | não | 2ª rodada | feito | 481eb51, a595c94 |
| Ordenação da lista por NUNOTA (Pedido) | feito | feito | sim | P | sim | 2ª rodada | feito | 41206cc |
| Lançamento múltiplo / importação | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Pedidos recorrentes | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Fila "Aguardando liberação" no app | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |

## Clientes

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| A–Z em Clientes | feito (servidor: GET /customers/letters) | existe | sim | P | sim | 1 | feito | d331698, 3c67f39 |
| Ficha do cliente com títulos e pedidos do cliente | existe | falta | não (a igualar) | M | a conferir | 2 | não iniciado | |
| Cadastro e edição de cliente | existe | divergente | não (a igualar) | G | a conferir | 4 | não iniciado (não iniciar) | |

## Catálogo

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Detalhe do produto | existe | feito | sim | M | não | 2 | feito | bc5e5e8 |
| "Máx. X%" na lista de produtos | conferir | existe | a conferir | P | não | 2 | não iniciado | |
| "Preço zero" (marcador) | existe | feito | sim | P | não | 2 | feito | 55d0662 |
| Agrupamento grupo > subgrupo > linha | existe | falta; o espelho só tem grupos planos | não (a igualar) | M | sim | 2 | não entregue | |

## Início, Perfil e Cabeçalho

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Indicador de sincronização | feito | feito | sim | M | não | 2ª rodada | feito | app 09de23e; site 3f15eac; 2026-11-25: só as duas setas, sem círculo/fundo, cor da linha = estado (verde #4ADE80, amarelo #FBBF24, vermelho #F87171; contraste >= 3:1 sobre o cabeçalho #001369), site a alinhar |
| Bloco de sincronização no Perfil | feito | existe | sim | M | não | 1 | feito | 60609ff |
| "Sobre" com versão e ambiente | feito | existe | sim | P | não | 1 | feito | 60609ff |
| Início com indicadores | existe | falta | não (a igualar) | M | a conferir | 2 | não iniciado | |
| Rótulo do Início "Produtos no aparelho" | feito | feito | sim | P | não | 2ª rodada | feito | |
| Foto de perfil (cópia de exibição) | existe | feita no código; exige APK 0.2.0 | sim (após APK) | M | sim | 2ª rodada | feito | 899e826, d26ce58 |
| Foto de perfil gravada no Sankhya (TSIUSU.FOTO) | n/a | n/a | sim (servidor) | M | sim | 2ª rodada | feito atrás de flag fechada; fio NEEDS VALIDATION | a9c91eb, ed2b428, 70e5b9a, c083500, 2135eb7, db56a27 |
| Aviso de mobilidade | n/a | feito | só app por natureza | P | não | 2ª rodada | feito | 1881e42 |
| Remoções do app (itens retirados) | n/a | feito | sim | P | não | 2ª rodada | feito | 899e826 |

## Papéis e áreas administrativas

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Aprovações, limites de desconto, integração, configurações | existe | n/a | só site por natureza | | | | feito | |
| Bloqueio de login operations/technical no app | | | FORA | | | FORA | fora de escopo | |

## Estados, rótulos e cores

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Estado/etapa "Barrado" (rótulo, tom, filtro) | feito | feito | sim | M | sim | 2ª rodada | feito | site 0f449f4; domínio/servidor c295134; app 1881e42 |
| Tom de pedido na fila (âmbar) | feito | feito | sim | P | não | 2ª rodada | feito | 41206cc |

## Textos

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Remoção de textos explicativos | feito | feito | sim | P | não | 2ª rodada | feito | site 0ed6f07; app 1780593 |

## Só de um lado por natureza

Não contam como divergência. Se o dono decidir uma regra ligada a esses itens, o equivalente do outro lado deve ter a mesma regra e o mesmo resultado visível (PAR-1).

**Só app** (depende do aparelho):
- Base local/offline e sincronização com o aparelho (P-07/P-08).
- "Salvo no aparelho" (no site o equivalente é salvar no servidor).
- Câmera.
- Pedidos retidos.
- Atualização do APK.
- Aviso de mobilidade.

**Só site** (administração e visão ampla; P-20/P-21 mantêm representantes externos só no mobile):
- Aprovações.
- Limites de desconto.
- Integração (Sankhya).
- Configurações.
- Fila "Aguardando liberação" (no app: Lote 3, a decidir).
- Busca global.
- /downloads.
