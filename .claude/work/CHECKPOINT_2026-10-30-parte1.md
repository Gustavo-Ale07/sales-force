# Checkpoint 2026-10-30 — Parte 1

Decisões: `docs/decisions.md` §3.16 (48206b1). Tudo desligado por padrão; nenhuma chamada ao Sankhya; staging intocado.

## Entregue
- Deploy: `4fc4cac`, `00e1261`, `c51e412` (sf-compose.sh, README-staging).
- Core A: `4f2cd30` modo de alçada erp|force (D-M), `a6c2dd3` P4 decimais, `9ffe5ae` TOP do pedido + duplicar como pedido (D-A/B), `ad92693` transportadora (D-C).
- Trilha C (PDF, D-J): template de domínio, web, mobile.
- Trilha B (SNK-7 + P2): migrações 0016/0017, consumidor do outbox, dry-run, `mapErpOrderStatus`, `sync.erp.orderStatus`, CODPARCTRANSP; correção de fronteira PROD-1 (nome da marca vira entrada do documento).
- UI web (A5/A6/A7/A7b): `1cafc62`, `97974a3`, `e97a6ef`. UI mobile: A6, A5, A7, A7b e paridade (5 commits). Fixtures: `16d8950`.

## Testes (árvore mesclada)
domain 407 · contracts 118 · db 77 · sankhya 288 · mobile-db 148 · ui 41 · web 470 · mobile 494 · server 1348. Typecheck e lint limpos. E2E/Maestro não rodados.

## Reviewer de segurança — sem críticos/altos
- MÉDIO 1: em modo `erp` o Force não aplica autoridade de desconto (P-10 literal); é a decisão D-M. Pendência do dono: confirmar que delegar ao Sankhya é aceitável e/ou exigir teto duro no servidor; até lá o modo `erp` não deve ir a produção.
- MÉDIO 2: "Compartilhar PDF" no mobile por representante não é auditado (P-20, L1). Pendência do dono: confirmar que não é "exportação" ou pedir evento de auditoria.
- BAIXOS: (3) grants por coluna mais estreitos em `force_worker`/`force_api` (db-roles.sql); (4) `confirmOrder` real não implementado; falha em `confirm` com NUNOTA conhecido estaciona (`park`), não rejeita; manter live bloqueado até validar; (5) CHECK de `erp_number` sem NOT VALID (ok no tamanho atual); (6) iframe de impressão: nunca incluir `allow-scripts`. Do PDF: L2 arquivo apagado logo após o share no Android, L3 logo http(s) de qualquer host.

## Desvios da Trilha B para confirmar
`sales_order.erp_number` reaproveitado (em vez de `erp_order_number`); esgotamento com NUNOTA conhecido => `unknown`; preço zero também bloqueia o envio; TOPs não confirmadas via `ORDER_DELIVERY_UNCONFIRMED_TOPS` (padrão 1000); W-32 (reprocesso manual) não feito.

## O que o P4 encontrou
Backend já decimal; faltavam as entradas (vírgula/ponto) e os passos de 0,2 no mobile, corrigidos. Sem passo por produto (adiado).

## Pendências do dono
Ver CURRENT.md "Só o dono roda — parte 1". Também: `repeatLast` pode escolher orçamento; `.env.example`/`worker.env.example` precisam das novas variáveis (bloqueado por regra).
