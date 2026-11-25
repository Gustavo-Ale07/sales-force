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
| Pedidos do servidor no app | O sync traz para o aparelho TODOS os pedidos da mesma conta (feitos no site ou em outro aparelho) e mescla na lista local. Usa o nome do cliente que vem no pedido. "Precisa de correção" e "Verificando envio" caem em "Não enviados"; o restante em "Enviados". Mostrar o mesmo texto de erro de "Precisa de correção" nos dois lados. Inclui schema do mobile-db, sync e testes. Causa hoje: a lista do app lê só o banco local (pedidos criados no aparelho); o sync só atualiza o status dos ids já locais. | Sim (sync) | Feito (código e testes); Implementado em 25/11 (sem endpoint novo: GET /orders?mine=true; sem migração de schema): o sync mescla os pedidos do servidor na lista local, por id do servidor (idempotente, nunca duplica; linha com comando pendente nunca é sobrescrita nem apagada). Grupos no app: Regra final de grupos (dono, 2026-11-25; servidor, site e app iguais): só `sent` é Enviados; draft, awaiting_approval, approved, approval_rejected, queued, rejected e unknown são Não enviados. Texto do motivo de Precisa de correção: deliveryErrorText movido para packages/domain e usado pelo site e pelo app (mesmo texto; app mostra no detalhe do pedido, a lista do app não mostra o motivo). Pedido apagado no site não some do app (sem poda, aberto). Não verificado em aparelho. |
| Texto após confirmar o envio | Logo após confirmar, site e app dizem "Enviado ao Sankhya" (pedido e orçamento; badge de queued igual). "Recebido no Sankhya" só quando a etapa chega. Não confundir com "Enviado ao Force" (sent_to_force). Não verificado em aparelho. | não | feito (app) |
| Motivo de Precisa de correção na lista do app | O app mostra, sob o badge de cada pedido que precisa de correção, o mesmo motivo do site (texto do servidor). Não verificado em aparelho. | não | feito (app) |
| Nível da fila de liberação no app | O app mostra `erpStage.releaseLevel.text` como vem ("Nível N" / "Ainda não confirmado no Sankhya"), na lista (sob o badge) e no detalhe; nada se nulo. Guardado em erp_stage_json (sem migração). Sem TSILIM/setores. Não verificado em aparelho. | sim (existente) | feito (app) |
| Ficha do cliente no app: Financeiro, Pedidos do cliente, Repetir último pedido | Online o app lê GET /customers/{code}/financial (limites, em aberto, vencido, bloqueio, títulos em aberto; 404 = sem seção) e mostra só o que o servidor entrega, sem custo/margem. "Pedidos do cliente" lê os pedidos do aparelho (que já inclui os do site). "Repetir último pedido" abre um pedido novo com os produtos e quantidades do último pedido registrado no Force, a preço de hoje (mesma rota local do Duplicar; offline também). "Análise do cliente" e "Engajamento" não existem no site (regra indefinida): não há no app. Não verificado em aparelho. | sim (existente) | feito (app) |

## Vendas e pedidos

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Tela cheia de atualização de dados | feito | existe | sim | M | não | 1 | feito | da6d982 |
| Presets de data em Vendas | feito | existe | sim | P | não | 1 | feito | dc9e370 |
| Abas Não enviados / Enviados em Vendas | feito (group no servidor) | existe | sim | M | sim | 1 | feito | 22506c0, 3bcfe71 |
| "Continuar o pedido em andamento?" | feito | existe | sim | P | não | 1 | feito | f0cd036 |
| Filtro de Venda | removido do site (decisão do dono 25/11); a listagem do site pede sempre `sellable=true` | não existe; o servidor só entrega produtos vendáveis ao aparelho | sim (só vendáveis nos dois lados) | P | não | 2ª rodada | feito | ver commit |
| Aviso de origem do preço na lista | existe | feito (25/11): linha acima da lista "Preços da tabela N — Nome (tabela de referência do catálogo / do cliente / alternativa)", ou "Nenhuma tabela de preço se aplica..." (mesmo texto do site). Offline: o sync guarda o `priceContext` do catálogo (uma página de 1 item de `GET /products`) e o nome de cada tabela (`GET /price-tables/{code}/prices`) em `sync_metadata`, sem migração nova; na tela de Novo pedido segue a tabela do cliente. Sem origem conhecida no aparelho, a linha não aparece (nada é inventado). Rótulos duplicados do site (`priceContextSourceLabels`) por o app não importar do web | sim | M | não | 2 | feito; não verificado em aparelho | ver commit do lote |
| Filtro de pedidos por produto | existe | feito | sim | M | não | 2 | feito | 3a44ff1, 4595ffc |
| Datas por atualização ("Período por") | existe | feito | sim | P | não | 2 | feito | 3a44ff1, 4595ffc |
| Ordem/estrutura do filtro de situação | divergente | divergente | não (a igualar) | P | não | 2 | não iniciado | |
| Rótulos e controle de quantidade | feito | já igual | sim | P | não | 2ª rodada | feito | 3ddf4c7 |
| Pedido "Precisa de correção" editável (servidor) | editável | editável após sync | sim | M | sim | 2ª rodada | feito | 2d45839, c9e002e |
| "Precisa de correção" editável (site) | editável; com nº Sankhya fica só leitura (SNK-4) | | sim | M | não | 2ª rodada | feito | 41206cc, 0663f5f |
| "Precisa de correção" editável (app) | | editável só sem nº Sankhya (SNK-4) | sim | P | não | 2ª rodada | feito | 481eb51, a595c94 |
| Texto logo após confirmar o envio: "Enviado ao Sankhya" (decisão do dono 25/11) | feito (aviso e janela de envio) | pendente: ainda diz "Pedido enviado" / "Orçamento enviado" (`apps/mobile/src/ui/new-order-screen.tsx` ~l.1054, e testes `new-order-screen-confirm.test.tsx`) | não (a igualar no app) | P | não | 2ª rodada | site feito; app com o agente do app | ver commit |
| Foto no perfil Operações: "Perfil" no menu do avatar e página `/perfil` só com a foto e a conta, sem sincronização (decisão do dono 25/11) | feito | a conferir com o agente do app (Operações é só web) | só site por natureza | P | não (a política do servidor já permite `/me/photo` a todo perfil) | 2ª rodada | feito | ver commit |
| Ordenação da lista por NUNOTA (Pedido) | feito | feito | sim | P | sim | 2ª rodada | feito | 41206cc |
| Lançamento múltiplo / importação | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Pedidos recorrentes | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |
| Nível aguardado (decisão do dono 25/11; texto do servidor exato: "Nível N" / "Ainda não confirmado no Sankhya"; nada se null/ausente; nunca de setores/TSILIM) | feito: coluna "Nível" na fila (`items[].releaseLevel.text`, "—" se ausente) e, junto à etapa do pedido, " · Nível N" depois da etapa/setor no chip da lista e na linha "Situação no Sankhya" do detalhe (`erpStage.releaseLevel.text`) | em andamento com o agente do app | sim (mesmo texto, mesma posição) | P | não (contrato aditivo, docs/implementation/release-queue.md) | 2ª rodada | site feito; app em andamento | ver commit |
| Fila "Aguardando liberação" no app | existe | falta | não (a igualar) | G | a conferir | 3 | não iniciado (não iniciar hoje) | |

## Clientes

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| A–Z em Clientes | feito (servidor: GET /customers/letters) | existe | sim | P | sim | 1 | feito | d331698, 3c67f39 |
| Ficha do cliente com títulos e pedidos do cliente | existe | falta | não (a igualar) | M | a conferir | 2 | não iniciado | |
| Cadastro e edição de cliente | feito | feito | sim | G | sim | 4 | feito (ver D-AP, D-AR abaixo) | |

## Catálogo

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Detalhe do produto | existe | feito (25/11): acrescentados Situação (Ativo/Inativo), Uso e origem do preço com nome da tabela e tipo, como no site. `usageCode` passou a ir também no item da lista (`GET /products`, aditivo e opcional, sem custo/margem; teste de integração); no aparelho aparece após o próximo sync do catálogo ("—" até lá) | sim | M | não | 2 | feito; não verificado em aparelho | bc5e5e8; ver commit do lote |
| "Máx. X%" na lista de produtos | conferir | existe | a conferir | P | não | 2 | não iniciado | |
| "Preço zero" (marcador) | existe | feito | sim | P | não | 2 | feito | 55d0662 |
| Agrupamento grupo > subgrupo > linha | existe | feito no app (25/11): cascata Grupo > Subgrupo > Linha no filtro do Catálogo (mesmos níveis e nomes do site; Subgrupo desabilitado até haver filho; trocar um nível limpa os de baixo; "Sem grupo" só no 1º nível e só com `hasUngrouped`); o sync baixa `/product-groups` junto do catálogo (mobile-db migração 15 `cache_product_group`, só adição; falha mantém a árvore anterior); filtro offline por `subtreeCodes` (igual ao servidor); sem hierarquia no aparelho cai no filtro plano. Antes o filtro era multisseleção de grupos planos; agora é seleção única como no site | sim | M | feito (servidor e app) | 2 | feito; não verificado em aparelho | ver commit do lote |

## Início, Perfil e Cabeçalho

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Indicador de sincronização | feito | feito | sim | M | não | 2ª rodada | feito | app 09de23e; site 3f15eac; 2026-11-25: só as duas setas, sem círculo/fundo, cor da linha = estado (verde #4ADE80, amarelo #FBBF24, vermelho #F87171; contraste >= 3:1 sobre o cabeçalho #001369), site: setas 24 px, alvo 44x44, mesmos hex (cabeçalho #01136a, contraste 6,1 a 10 : 1); app 514a460 |
| Gatilhos da tela cheia de atualização | só login real (não existe no site), indicador e "Sincronizar agora" no Perfil; menu do avatar sem "Atualizar dados" e não modal | login, indicador, Sincronizar agora | sim | P | não | 2ª rodada | feito | ba4c298 |
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
| Bloqueio de login operations/technical no app | servidor: `POST /auth/login` com `client: 'app'` recusa technical/operations com `app_not_permitted` (403), auditado; site inalterado | app envia `client: 'app'` e exibe `APP_NOT_PERMITTED_MESSAGE` (contracts) | servidor sim | S | n/a | servidor feito; app pendente (agente do app) | servidor feito | ver commit E |
| Edição de cliente (D-AP) | servidor: `PATCH /customers/{code}` no contrato; sempre 409 (`customer_edit_disabled` / `customer_edit_delivery_not_approved`), escopo por carteira, sem gravação; `general.clientEditEnabled` na configuração (hoje sempre `false`) | mesma regra no site; app idem; não exibir enquanto `clientEditEnabled` não for `true` | servidor sim | S | n/a | feito (Lote 4, site e app) | Lote 4 site FEITO; app FEITO (tela Editar cliente na ficha, só com `clientEditEnabled=true` guardado pela sincronização; só online, sem fila local: offline avisa e não envia; sem Salvo/Aguardando local para edição): "Editar cliente" na ficha só com `clientEditEnabled=true`, campos Telefone, E-mail, Observações, Contatos (Nome do contato, Cargo, Telefone do contato, E-mail do contato); só o preenchido é enviado; estados "Aguardando envio ao Sankhya" / "Enviado ao Sankhya" / "Precisa de correção" com o texto do servidor; recusas 409/400 em texto. Endereços fora (catálogo CEP/rua/bairro em aberto). | `docs/implementation/customer-create-edit.md` |
| Cadastro de cliente (D-AR) | `POST /customers` atrás de `clientCreationEnabled` | mesmos campos e nomes no site e no app | servidor sim | M | n/a | feito (Lote 4, site e app) | Lote 4 site FEITO; app FEITO (tela Novo cliente na lista, salva no aparelho como Salvo e a sincronização entrega, também offline): "Novo cliente" na lista só com `clientCreationEnabled=true`; campos CPF/CNPJ, Classificação ICMS (C, I, P, R, T, X; R padrão), Razão social ou nome, Nome fantasia, Inscrição estadual + Isento, Telefone, E-mail, Observações; PJ exige IE ou Isento, PF sem IE; sem endereço. Nomes das classes ICMS em aberto. | `docs/implementation/customer-create-edit.md` |

## Estados, rótulos e cores

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Estado/etapa "Barrado" (rótulo, tom, filtro) | feito | feito | sim | M | sim | 2ª rodada | feito | site 0f449f4; domínio/servidor c295134; app 1881e42 |
| Tom de pedido na fila (âmbar) | feito | feito | sim | P | não | 2ª rodada | feito | 41206cc |

## Textos

| Item | Site | App | Igual? | Esforço | Servidor? | Lote | Situação | SHA |
|---|---|---|---|---|---|---|---|---|
| Remoção de textos explicativos | feito | feito | sim | P | não | 2ª rodada | feito | site 0ed6f07; app 1780593 |
| Ordem e nomes do menu (Início, Clientes, Vendas, Catálogo, Perfil; gestão depois) | feito | feito | sim | P | não | 3ª rodada | feito | ab29ad0 |
| Início e Perfil sem textos que o app não tem | feito | feito | contadores do servidor x aparelho: ver auditoria | P | não | 3ª rodada | feito | ab29ad0 |
| Vendas: busca, Total, Valor parcial, vazios | feito | feito | sim | P | não | 3ª rodada | feito | 5ef16d5 |
| Catálogo: título, Visualização Grade/Lista, busca, vazios | feito | feito | sim | P | não | 3ª rodada | feito | bcacf45 |
| Clientes: busca, Com/Sem tabela de preço, vazios, títulos da ficha | feito | feito | sim | P | não | 3ª rodada | feito | 3430713 |
| Editor de pedido: rótulos de ação e estrutura | difere | assistente | não | G | não | a decidir | aberto | ver docs/implementation/text-audit-app-x-site.md |

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
