# CHECKPOINT 2026-10-08 — Sankhya como fonte de verdade dos usuários + fotos de produto no fluxo de venda

Nota de continuidade, sem autoridade de decisão (a autoridade é `docs/decisions.md`). Reconstruída em 2026-10-28 a partir de `1ed8db3`, `e705f2f`, `docs/implementation/auth-username-flow.md` e dos scripts de `.claude/work`. Repo `sales-force-evolution` · branch `feat/sales-force-evolution`.

## O que mudou no dia
- `1ed8db3` — **Sankhya como fonte de verdade dos usuários Force**
  - `401 invalid_credentials` somente para credencial Sankhya errada; `403 access_not_configured` (sem sessão) quando o Sankhya autentica mas o acesso Force não está provado. A auditoria guarda o motivo técnico.
  - Contas externas manager/admin/técnica existentes pulam a sincronização de vendedor (SUP continua manager, sem CODVEND, sem `external_directory_refused`).
  - Só vínculos `sankhya_auto` são reconciliados/revogados pelo espelho (login e `resolveSession`); vínculos `manual` nunca são tocados.
  - Espelho permanente: `AUTH_DIRECTORY_SYNC_ENABLED` / `AUTH_DIRECTORY_SYNC_CRON` agendam só `sellers` + `directoryUsers` (padrão a cada 15 min) com sincronização na partida.
  - Web e mobile exibem a mensagem de `access_not_configured`.
- `e705f2f` — **fotos de produto no fluxo de venda**: seletor, multisseleção, linhas do pedido; `OrderItemDetail` carrega metadados de imagem.
- Scripts do dia em `.claude/work`: `check-directory-mirror.sh`, `trace-sup-login.sh` + `staging-sup-login-trace.sql`, `sync-sellers-directory-users-once.sh`, `enable-auth-directory-sync-staging.sh`, `enable-auto-provision-staging.sh` (NÃO rodar sem ordem do dono), `retry-seller-autoprovision.sh`, `validate-sankhya-auth-live.sh`, `validate-login.sh`, `sankhya-idusu-proof.mjs`, `prove-idusu-codusu-vps.sh`, `product-media-staging.sh`. Corpos de login vão por stdin ao curl (senha nunca em argv) — `7658344`.

## Provado × pendente
| Fato | Estado |
|---|---|
| SUP entra como manager externo; manager local segue bloqueado por senha | provado (07/10) |
| Espelho `erp_directory_user` (migration 0011), `decideDirectorySeller`, revogação só de `sankhya_auto` | implementado e testado; **população real do espelho não confirmada** |
| idusu = Base64 do código decimal do usuário e estável entre logins | observado |
| idusu decodificado == `TSIUSU.CODUSU` | **NÃO provado** (servidor recusa subir com auto-provisionamento sem `EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1`) |
| Coluna de bloqueio/inativo de TSIUSU | **NÃO validada**; revogação ≈ cron do espelho (15 min) + 60 s |
| Causa da recusa do GUSTAVO SOUSA | **NÃO provada** (hipótese: `external_unmapped`) |
| Resultado real dos scripts de 08/10 na VPS | desconhecido — não há registro |

## Verificação em 2026-10-28 (worktree de evolução)
- `pnpm typecheck` e `pnpm lint`: limpos.
- Testes que passaram: domain 292 · contracts 114 (inclui o novo guarda de cost/margin) · sankhya 223 · mobile-db 137 · web 421 · mobile 37 suítes.
- **server e db NÃO rodados: Docker Desktop desligado** (Testcontainers). O teste novo `apps/server/test/integration/products-restricted-data.test.ts` compila e passa no lint, mas **nunca executou**.

## O que falta
1. Rodar server + db com Docker ligado (inclui o teste novo de /products; ajustar se algum papel receber status inesperado).
2. Provas do dono: idusu ↔ CODUSU e diagnóstico do espelho/recusa (ver "Só o dono roda" em `CURRENT.md`).
3. Decisões do dono (tabela em `CURRENT.md`).
4. Só depois das provas: flags de auto-provisionamento em staging, validação real do GUSTAVO.
5. Pedidos ao Sankhya TESTE: próxima fase, não iniciada (SNK-4/SNK-6 intactos).

## Por onde retomar
`CURRENT.md` (tabela de decisões + "Só o dono roda") → rodar server/db → colar saídas das provas → registrar fatos em `docs/sankhya-spike.md`.
