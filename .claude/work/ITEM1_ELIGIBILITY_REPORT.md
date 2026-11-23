# ITEM 1 — Elegibilidade única de cliente (relatório)

## 1. Quem decide "cliente elegível" (mapa)

| Local | Regra aplicada |
|---|---|
| Leitura Sankhya (`packages/sankhya/src/real/mapping.ts` `customerSpec` + `read-scope.ts` `customerExclusion`) | `CODPARC > 0` + `customers.eligibility` da configuração: `activeOnly` (ATIVO), `requiredFlags` (colunas = 'S', ex. CLIENTE), `columnIn` (coluna in valores). Sem `eligibility` na config: só `CLIENTE='S'`. BLOQUEAR e CODVEND NÃO filtram aqui. |
| Escopo derivado (`apps/server/src/sync/mirror-scope.ts` `deriveReadScope`) | Copia `customers.eligibility` da config para o ReadScope. Sem outra regra. |
| Ingestão no espelho (`mirror-entities.ts` + `mirror-writer.ts deactivateMissing`) | Parceiro descartado pela regra não é "visto" -> `deleted_at` preenchido (soft delete) ao fim de uma leitura COMPLETA. Reaparece se voltar a ser elegível. Bloqueado, inativo (com activeOnly=false) e sem vendedor FICAM no espelho (pedidos existentes leem estado/motivo). |
| Lista/busca/ficha web e fonte do cache do app (`mirror.repository.ts` `liveCustomer`, usado por `listCustomers`, `findCustomer`, `countCustomers`, `priceTableCodesInScope`) | ANTES: não deletado + `is_customer` + ATIVO + não bloqueado. **Sem exigir vendedor.** |
| Criar/editar rascunho (`orders.service.ts assertCustomerEligible` via `requireForOrder`, includeHidden) | domínio `customerOrderBlock`: ativo, não bloqueado, **vendedor CODVEND >= 1**. |
| Envio (`orders.service.ts` ~l.705, `customerStates`) | mesmo `customerOrderBlock`; linha ausente/deletada => `customer_unavailable`; erro 409 `customer_ineligible` com `details.reason`. |
| `erp-eligibility.guard.ts` | NÃO é elegibilidade de cliente: é elegibilidade do PEDIDO para o ERP (binding/ambiente). Não participa. |
| Catálogo (`catalog.service.ts`) | usa o cliente já validado pelo escopo (`requireVisible`). |
| App (`mobile-db reference-cache.ts customerBlockOf`, `local-orders.ts`) | Cache substituído por inteiro a cada pull da lista do servidor; guarda local só olha `active`/`blocked` (indicativo). Não olhava vendedor. |

## 2. Divergência e causa provável do 5020

Divergência única entre lista/sync e envio: **vendedor válido (CODVEND >= 1)**. A lista (e, portanto, o cache do app) mostrava
clientes com CODVEND nulo/0 para perfis de escopo "all" (admin/diretor/backoffice); criar/enviar recusa com `customer_without_seller`
(reason `customer_without_seller`). Os demais critérios (ATIVO, BLOQUEAR, deleted, is_customer) eram idênticos.

Hipótese principal para o 5020: CODVEND nulo/0 no Sankhya (listado só para escopo "all"). **Não confirmada**: depende do dado real
(script abaixo). Hipóteses secundárias: (a) cache do aparelho velho, cliente tombado/bloqueado depois do último pull (envio dá
`customer_unavailable`/`customer_blocked`; inevitável offline, agora com motivo estruturado); (b) app antigo com o texto genérico
"Cliente indisponível — revise o rascunho" (CUSTOMER_UNAVAILABLE_MESSAGE).

O "selo" do PDF é o badge de status (`statusLabel` -> `saleBadge`) que imprimia "Cliente indisponível".

## 3. Tombstone de quem deixa de ser elegível

Existe: `deactivateMissing` marca `deleted_at` em quem a leitura completa não trouxe mais (descartado pela regra = não visto).
Falha fechada em snapshot vazio. Quem fica bloqueado/inativo/sem vendedor continua no espelho mas some da lista; o cache do app é
substituído por inteiro no pull seguinte (some do aparelho). Offline o cache só é corrigido no próximo pull (limite inerente).

## 4. Hipótese "revendedor" e script (Sandbox `placfestas-teste`, SOMENTE LEITURA, só contagens)

Campo: `TGFPAR.CLASSIFICMS = 'R'`. NÃO reintroduzir (removido de propósito em 2026-11-13, e9bf8a4).

```sql
-- (a) linha do 5020
SELECT CODPARC, NOMEPARC, ATIVO, CLIENTE, BLOQUEAR, CODVEND, CLASSIFICMS, CODTAB
FROM TGFPAR WHERE CODPARC = 5020;

-- (b) contagens (Force hoje: 5.803 sem R; 5.737 com R)
SELECT
  SUM(CASE WHEN CLASSIFICMS = 'R' THEN 1 ELSE 0 END)                       AS com_r,
  SUM(CASE WHEN NVL(CLASSIFICMS, ' ') <> 'R' THEN 1 ELSE 0 END)            AS sem_r,
  COUNT(*)                                                                 AS total,
  SUM(CASE WHEN NVL(CODVEND, 0) < 1 THEN 1 ELSE 0 END)                     AS sem_vendedor
FROM TGFPAR
WHERE CODPARC > 0 AND ATIVO = 'S' AND CLIENTE = 'S' AND NVL(BLOQUEAR, 'N') = 'N';
```

(`sem_vendedor` e confirma o numero de clientes que a mudanca abaixo deixa de listar; se o total sem vendedor for > 0 o 5020 pode estar entre eles.)

Se o filtro voltasse: só configuração — `customers.eligibility.columnIn = [{column:'CLASSIFICMS', values:['R']}]` + config-bootstrap
(owner decide). No app: nada muda no código; ~66 clientes (5.803 -> 5.737) sairiam do espelho (tombstone no próximo sync completo),
da lista e do cache no pull seguinte; pedidos já criados continuam legíveis; rascunhos desses clientes passam a `customer_unavailable`.

## 5. Mudanças feitas

- `mirror.repository.ts`: predicado único `eligibleCustomerConditions()` (espelha `customerOrderBlock`), usado por lista, busca, ficha, contagem, tabelas de preço e fonte do cache. Agora exige `seller_code >= 1`.
- `orders.service.ts`: `customer_without_seller` agora também leva `details.reason` (vocabulário único).
- `apps/mobile/src/offline/order-pdf.ts`: o PDF nunca imprime o selo "Cliente/Produto indisponível" (usa "Rascunho").
- Contrato: nenhuma mudança de schema/OpenAPI (só semântica da lista e detail do erro, campo `details` já genérico). Sem migration.
  Ordem: servidor pode ir antes do OTA; o PDF é só mobile e independe do servidor.

## 6. Testes a escrever/atualizar (método do dono: no fim)

- Paridade: para cada combinação (ativo, bloqueado, seller null/0/>=1, deletado, is_customer) `eligibleCustomerConditions` == `customerOrderBlock === null` (integração, Postgres real).
- Lista/busca/ficha/contagem excluem cliente sem vendedor para escopo "all"; `requireForOrder` ainda devolve 409 `customer_without_seller` com `details.reason`.
- Tombstone: cliente que passa a inelegível some da lista/cache e recebe `deleted_at` (mirror-sync.test.ts).
- `order-pdf.test.ts`: `pdfStatusLabelOf` = "Rascunho" para cliente/produto indisponível.
- Podem ficar vermelhos: testes de integração (`customer-ineligible`, `api`, `authorization-matrix`, `mirror-sync`) que listam cliente com `seller_code` nulo.
