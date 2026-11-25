# Hierarquia do catálogo (Grupo > Subgrupo > Linha) — contrato para o app

Lote 2 da PAR-1 (`docs/parity-matrix.md`, linha "Agrupamento grupo > subgrupo > linha"). Base: D-AM (`docs/decisions.md`).

## Estado do servidor (já existia, validado)

- Espelho `erp_product_group` (TGFGRU, migração 0031): `code`, `name`, `parent_code` (CODGRUPAI; a sentinela `-999999999` de grupo raiz vira `null`), `degree` (GRAU), `analytic`, `active`. Fatos de leitura validados em `packages/sankhya/src/real/mapping.ts` (`PRODUCT_GROUP_SPEC`). Grupo 0 ("<SEM GRUPO>") nunca é espelhado.
- Nenhuma migração nova neste lote (a 0047 não foi usada): o modelo já tinha a hierarquia.
- Sem custo/margem em nenhum campo (P-20).

## Como o app obtém os dados hoje

O app NÃO usa o protocolo de sync por bundles para o catálogo: o `reference-source` baixa por REST paginado (`GET /products`) e agora deve baixar também `GET /product-groups` (hoje o mobile-db deriva grupos planos de `cache_product.group_code`).

`GET /product-groups` (`listProductGroups`, qualquer perfil autenticado, sem parâmetros) -> `ProductGroupsResponse`:

| Campo | Significado |
|---|---|
| `items[].code` / `name` | Código e nome do grupo (qualquer nível) |
| `items[].parentCode` | `null` = nível Grupo (topo). Também `null` para órfão (pai inativo/oculto) ou grupo dentro de ciclo (anomalia: promovido ao topo) |
| `items[].degree` | Nível informado pelo ERP (1 = Grupo); a cascata segue `parentCode`, não `degree` |
| `items[].hasChildren` | Há filho visível: o próximo nível (Subgrupo/Linha) abre |
| `items[].subtreeCodes` (NOVO) | O próprio código + todos os descendentes de qualquer profundidade na hierarquia completa (inclui descendentes inativos/ocultos), ordem crescente. É exatamente o conjunto que `GET /products?group=N` casa no servidor |
| `hierarchical` | `false` = tabela de grupos ainda vazia: lista plana derivada dos produtos (`parentCode` null, `subtreeCodes = [code]`) |
| `hasUngrouped` | Existe produto sem grupo (null ou 0): oferecer "Sem grupo" (valor `0`) |

Só entram grupos ATIVOS com produto visível nele ou abaixo (respeita `showInactive` da configuração), ordenados por nome (pt-BR).

Produto: `groupCode` / `groupName` continuam em `GET /products` (item e detalhe); o grupo do produto é a folha onde ele está classificado.

## Por que `subtreeCodes`

Filtrar offline só pela árvore visível divergiria do servidor: produto em subgrupo inativo apareceria no filtro do servidor para o grupo pai, mas não offline. Com `subtreeCodes` o app filtra `cache_product.group_code IN (subtreeCodes do grupo escolhido)` e obtém o mesmo resultado, sem reimplementar profundidade/ciclos.

## O que o app (mobile-db + UI) deve fazer

1. Baixar `/product-groups` junto do catálogo e guardar o JSON de cada grupo (tabela `cache_product_group`, expand-only no SQLite local, migração do mobile-db do agente do app); `hierarchical`/`hasUngrouped` em `sync_metadata`.
2. Filtro: cascata de 3 níveis como `apps/web/src/components/group-cascade-filter.tsx` (Grupo, Subgrupo desabilitado até haver filho, Linha só se o subgrupo escolhido tem filhos; trocar um nível limpa os inferiores; "Sem grupo" só no 1º nível e só com `hasUngrouped`). A lógica pura `cascadeLevels`/`groupFilterValue` do web pode ser espelhada.
3. Filtrar produtos: grupo escolhido -> `group_code IN (subtreeCodes)`; "Sem grupo" -> `group_code IS NULL OR group_code = 0`.
4. Enquanto `hierarchical = false` ou sem cache de grupos: manter o filtro plano atual.
5. Compatibilidade: campo novo é aditivo; clientes antigos ignoram `subtreeCodes`.

## Não entregue / aberto

- Sync por bundles (SYNC-x, PROPOSED) não é usado para o catálogo; nada foi criado nele.
- Nome do grupo no produto continua denormalizado em `erp_product.group_name` (nome do nível folha); caminho completo (Grupo > Subgrupo > Linha) por produto é derivável de `parentCode`, não é campo do produto.
- Rótulos "Subgrupo"/"Linha" são fixos por posição na cascata (como no site); o ERP não informa nomes de nível (NEEDS VALIDATION se o dono quiser rótulos por instalação).
