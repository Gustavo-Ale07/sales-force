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

## Vendas e pedidos

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Tela cheia de atualização de dados | falta | existe | não (a igualar) | M | não | 1 | não iniciado | |
| Presets de data em Vendas | falta | existe | não (a igualar) | P | não | 1 | não iniciado | |
| Abas Não enviados / Enviados em Vendas | falta | existe | não (a igualar) | M | não | 1 | não iniciado | |
| "Continuar o pedido em andamento?" | falta | existe | não (a igualar) | P | não | 1 | não iniciado | |
| Filtro de Venda e aviso de origem do preço | existe | falta | não (a igualar) | M | não | 2 | não iniciado | |
| Filtro de pedidos por produto | existe | falta | não (a igualar) | M | não | 2 | não iniciado | |
| Datas por atualização | existe | falta | não (a igualar) | P | a conferir | 2 | não iniciado | |
| Ordem/estrutura do filtro de situação | divergente | divergente | não (a igualar) | P | não | 2 | não iniciado | |
| Rótulos e controle de quantidade | feito | já igual | sim | P | não | 2ª rodada | feito | 3ddf4c7 |
| Pedido "Precisa de correção" editável (servidor) | editável | editável após sync | sim | M | sim | 2ª rodada | feito | 2d45839, c9e002e |
| "Precisa de correção" editável (site) | editável; com nº Sankhya fica só leitura (SNK-4) | | sim | M | não | 2ª rodada | feito | 41206cc, 0663f5f |
| "Precisa de correção" editável (app) | | falta `rejected` em `SUBMITTED_EDITABLE_STATUSES` (`packages/mobile-db`); aguarda decisão do dono | não | P | não | 2ª rodada | parcial | |
| Ordenação da lista por NUNOTA (Pedido) | feito | feito | sim | P | sim | 2ª rodada | feito | 41206cc |
| Lançamento múltiplo / importação | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Pedidos recorrentes | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Fila "Aguardando liberação" no app | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |

## Clientes

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| A–Z em Clientes | falta | existe | não (a igualar) | P | não | 1 | não iniciado | |
| Ficha do cliente com títulos e pedidos do cliente | existe | falta | não (a igualar) | M | a conferir | 2 | não iniciado | |
| Cadastro e edição de cliente | existe | divergente | não (a igualar) | G | a conferir | 4 | não iniciado (não iniciar) | |

## Catálogo

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Detalhe do produto | existe | falta | não (a igualar) | M | não | 2 | não iniciado | |
| "Máx. X%" na lista de produtos | conferir | existe | a conferir | P | não | 2 | não iniciado | |
| "Preço zero" (filtro/aviso) | existe | falta | não (a igualar) | P | não | 2 | não iniciado | |
| Agrupamento grupo > subgrupo > linha | existe | falta | não (a igualar) | M | não | 2 | não iniciado | |

## Início, Perfil e Cabeçalho

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Indicador de sincronização | feito | feito | sim | M | não | 2ª rodada | feito | app 09de23e; site 3f15eac |
| Bloco de sincronização no Perfil | falta | existe | não (a igualar) | M | não | 1 | não iniciado | |
| "Sobre" com versão e ambiente | falta | existe | não (a igualar) | P | não | 1 | não iniciado | |
| Início com indicadores | existe | falta | não (a igualar) | M | a conferir | 2 | não iniciado | |
| Rótulo do Início "Produtos no aparelho" | feito | feito | sim | P | não | 2ª rodada | feito | |
| Foto de perfil | existe | feita no código; exige APK 0.2.0 | sim (após APK) | M | sim | 2ª rodada | parcial | |
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
| Remoção de textos explicativos | em andamento | em andamento | sim (alvo) | P | não | 2ª rodada | parcial | |

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
