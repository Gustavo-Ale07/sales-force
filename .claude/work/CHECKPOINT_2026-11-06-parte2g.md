# CHECKPOINT 2026-11-06 — parte 2g (D-AB)

Branch `feat/sales-force-evolution`. Cada item com commit e push fast-forward próprios.

## Feito
- **B1** `fd1ffdd` — vocabulário "Confirmar pedido/orçamento", aviso de simulação corrigido.
- **B2** `499e154` — diálogo bloqueante "Enviando ao Sankhya…" ao confirmar, com o desfecho.
- **B3** `0347ce5` — "Atualizar dados" lê o Sankhya de verdade, via worker (API só registra em `sync_refresh`).
  - Contratos: `POST /sync/refresh`, `GET /sync/refresh/{id}`, `GET /sync/status` (Zod → OpenAPI → cliente).
  - Banco: tabela `sync_refresh`, migração `0028_sync_refresh.sql`, GRANT em `deploy/staging/db-roles.sql`.
  - Worker: fila `sync.refresh.on-demand` (registrada em `QUEUE_REGISTRY`), poller de 2 s, `SyncRefreshRunner` (11 etapas na ordem pedida; leitura somente; etapa que falha não interrompe as seguintes e mantém os dados antigos).
  - Web: `RefreshDataDialog` ("Atualizando dados do Sankhya"), "Dados do Sankhya de HH:MM" no menu do usuário.
  - `OrderErpStatusRun.failed` novo para a etapa de status dos pedidos.
- **B4** `1a1d538` — auditoria de carregamento: a maior parte já existia (esqueletos, `LoadingPanel`, `GlobalActivity`, `ErrorState`). Fechado: "Gerando PDF…", botão "Converter em pedido" com loading, rótulo "Tentar de novo". Regra em `.claude/rules/frontend.md`.
- **B5** — D-AB em `docs/decisions.md`; este checkpoint; `CURRENT.md`.

## Verificação (saída real)
- Servidor: `sync-refresh.test.ts` 13/13; unit 531/531; matriz de autorização e `order-erp-status` passam; `tsc` limpo.
- Web: `tsc` limpo; vitest 34 arquivos / 504 testes verdes. `@salesforce/ui`: vitest verde.

## Não verificado / riscos
- ESLint não roda neste ambiente; Playwright nunca rodado; `apps/web/e2e/submit.e2e.ts` está desatualizado ("Enviar ao Sankhya").
- A etapa real contra o Sankhya só pode ser vista em staging depois que o dono rodar a migração 0028 e o GRANT.
- Revisão automática de segurança apontou o `reason` por etapa visível a todo perfil operacional: é o mesmo texto mascarado (D-Q) já guardado em `sync_state`, pedido pelo dono; registrado como nota aceita em D-AB.
- Vocabulário do app móvel (A5) fica para a parte 3.

## SNK-7 teste #1 (autorização do dono, 06/11)
Autorizado pelo dono (Sandbox, 40 requisições, cliente 5778, pedidos A, B e C, reenvio do A, limpeza). **Não executado por mim**: roda pelo worker de staging do dono (`deploy/scripts/sf-compose.sh exec worker node dist/ops-order-resend.js <id>`); não tenho credenciais. `docs/implementation/snk-7-dry-run.md` ainda não descreve o pedido C (13 itens, uma única `incluirNota`): ajustar o roteiro antes de rodar.
