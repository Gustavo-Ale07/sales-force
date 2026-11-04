# Checkpoint — 2026-11-04, parte 2d (comporta de ambiente, vocabulário único, Excluir)

Branch `feat/sales-force-evolution`. Decisões: D-X e D-Y em `docs/decisions.md` §3.20. Nada tocado em staging, `compose.env`, flags, override, enable-* ou deploy.

## Commits

| Item | Hash | O que mudou |
|---|---|---|
| K1 | `898bde6` | `SF_ERP_ENVIRONMENT` com vocabulário Sankhya `sandbox`/`production` |
| K2 | `b9287a1` | deploy aborta se `SF_ERP_ENVIRONMENT` ≠ `SANKHYA_ENVIRONMENT` |
| K3 | `f1efd07` | pedido rejeitado mostra por que a última entrega falhou (classe + código, rótulo humano) |
| K4 | `532fe64` | 409 no envio mostra um texto por motivo |
| K7 | `ebd8b23` | Excluir no lugar de Descartar (D-Y), migrações 0024/0025 |
| K8 | `66baa8f` | subtítulo de Vendas segue o que a API aplica |

## K5 — achados (somente relatório)

Pedido nº 5 levou 409 no POST /submit (requestId 089a9be6) porque veio de um dataset falso: motivo `dataset_not_erp`, vindo de `assertEligibleForErpSubmission`. O pedido nº 6 ficou "na fila" mas falhou no worker, e a causa era a divergência de ambiente:

- Comparação no worker: `packages/domain/src/erp-eligibility.ts:26-33` (`erpSubmissionBlock`), chamada em `apps/server/src/integration/order-delivery.service.ts:237`; a falha é gravada por `finishRejected(... 'validation', block ...)` por volta da linha 239.
- Alvo do worker fixo em `apps/server/src/main-worker.ts:65` (`target: { environment: 'sandbox' }`).
- A API grava `erp_environment` a partir de `SF_ERP_ENVIRONMENT` (antes `staging`, agora `sandbox`).
- Efeito: com `staging` no pedido e `sandbox` no alvo, o worker rejeitava como validação. O vocabulário único (K1) e a checagem no deploy (K2) fecham a causa; K3/K4 tornam o motivo visível ao vendedor.

## K7 — Excluir (D-Y)

- Excluível: sem `erp_number` e sem entrega `pending`/`processing`/`unknown`; status draft, awaiting_approval, approved, approval_rejected ou rejected. `queued`, `sent` e `unknown` não têm Excluir. Isto **aposenta o comportamento D-5** "cancelar um pedido na fila": agora o pedido na fila não pode ser excluído.
- Remove `sales_order` (itens e aprovações por `ON DELETE CASCADE`) e as entregas terminais (dry-run por cascata); auditoria `order.deleted`.
- Contrato: `DELETE /orders/{id}` responde 204 (`deleteOrder`); motivos 409 `has_erp_number` e `delivery_in_progress`. `cancelled` saiu do contrato, web (botão, filtro, listagem, impressão, painel) e do status do banco.
- "Repetir último pedido": com exclusão física, um novo clique com o mesmo `clientRequestId` depois de excluir o rascunho criado devolve 409 `no_previous_order` se não restar pedido anterior (antes devolvia o rascunho "descartado"). Documentado e coberto por teste.
- Migração 0024 (dados) apaga os pedidos descartados existentes e imprime a contagem com `RAISE NOTICE`; 0025 (contrato) troca o CHECK de status. **Contagem de pedidos descartados apagados: ainda não executada em nenhum banco com dados** (só roda quando o dono aplicar as migrações; staging só tem testes, produção não existe). Registrar o número do NOTICE aqui quando rodar.
- Mobile: somente registrado para a parte 3 (sync deve parar de enviar/receber `cancelled`).

## K8 — subtítulo de Vendas

O texto "O envio ao Sankhya ainda não está habilitado nesta instalação" era **fixo no código** (`orders.tsx`), não um cache de flag. Agora `GET /order-entry/configuration` devolve `general.erpSubmissionEnabled` (o `ERP_ORDER_ENQUEUE_ENABLED` aplicado pela API) e a tela de Vendas revalida com `staleTime: 0` ao abrir e ao voltar para a aba. Só mostra o aviso quando a API diz `false`; ausente ou `true` não mostra.

## Verificação feita

typecheck e lint do monorepo limpos. Web 493 testes; contracts 124; domain 430; db 78; server: suites de pedidos, enfileiramento, matriz de autorização, repetir último, papéis restritos, configuração de entrada e iam-support passando. A suíte de integração completa do servidor (~13 min) **não** foi rodada nesta parte; roda no fechamento da parte 2c.

## Só o dono roda

1. Rodar `db-roles.sql` em staging (novos GRANTs de DELETE para `force_api` em `sales_order` e `integration_outbox`); sem isso, Excluir falha por permissão.
2. Aplicar as migrações 0024 e 0025 no deploy e anotar a contagem do NOTICE da 0024.
3. Conferir no web: Excluir some em pedido com número do Sankhya ou na fila; subtítulo de Vendas some com o envio ligado.

## Deslizes de processo (divulgação)

Ao longo da parte 2d usei heredocs por engano (cinco vazios e um real em `docs/sankhya-spike.md`, mais um `python - <<'X'` que travou e foi interrompido neste trecho), um `git commit --allow-empty` seguido de `git reset --soft HEAD~1`, e uma citação mal escapada em `node -e`. Nenhum afetou dados; os arquivos resultantes foram conferidos. Também apaguei uma linha a mais com `sed -i` durante a edição de `commercial-orders.test.ts` e restaurei logo em seguida.
