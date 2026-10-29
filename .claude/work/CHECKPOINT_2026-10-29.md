# CHECKPOINT 2026-10-29

Repo `C:\Dev\sales-force-evolution`, branch `feat/sales-force-evolution`, publicada em `origin` (fast-forward). Base da sessão: `4ab773b`.

## Feito (commits)
- Decisões: `a3b7239` registra Q1-Q13 e D13-D20 como APPROVED (`docs/decisions.md` §3.15; AUTH-13/14/15, OPS-7, DISC-5/6, ORD-1/2, MOB-8). D1-D12 (§3.14) conferidas linha a linha com o texto original: nenhuma divergência.
- Trilha C (plano, sem código): `b435aac` `docs/implementation/snk-7-order-submission-plan.md` (10 fatias S1-S10).
- Trilha A (auth e base): A1 `68dceb7` · A2 `a57e292` (D2), `b5348aa` (D3), `27e86ec` (D4), `42f6fbb` (D13) · A3 `4544282` (D6), `d488dc9` (D7) · A4 `2bc30e4` · A5 `5ce650a` (E2E trazido por `8571ced`). security-reviewer: sem achados.
- Trilha B (alçada): B1 `eb0f0ce` · B2 `63d85aa` · B3 `f04e366` (migration 0013) · B4 `37d3b61` · B5 `675932e` · B6 sem commit (auditoria e recálculo `recomputeOrderAuthority` já cobertos por B3/B4) · ajuste `ef10d6e`. security-reviewer: 0 alto, 0 médio, 3 baixos (abaixo).
- Config: `8571ced`, `da327c5` (regras de permissão do dono em `.claude/settings.json`).
- `C:\Dev\sales-force` arquivado em `C:\Dev\_arquivo\sales-force-20261029`.

## Verificação (saída real)
- Baseline em `4ab773b`: typecheck e lint limpos; db 72, domain 316, mobile-db 137, ui 41, sankhya 223, contracts 114, web 421, server 1169.
- Fim da Trilha A: server 1184, E2E Playwright 34/34, typecheck e lint limpos.
- Fim da Trilha B (rebaseada, antes do push): server 1238, web 436 + 2 flaky, domain 341, db 73, contracts 118, mobile 432, mobile-db 137, ui 41, sankhya 223; typecheck e lint `pnpm -r` limpos.
- Flaky sob carga: `order-editor-discounts.test.tsx` e `order-templates.test.tsx`; isolados passam 43/43.

## Achados baixos (security-reviewer, Trilha B) — pendentes
1. Sem regra contra auto-aprovação (gerente submete rascunho de vendedor e aprova; ou vendedor promovido). Precisa de decisão do dono; DISC-4 não proíbe.
2. Pedido `approved` pula o recálculo no envio; pré-condição do slice S7 do plano SNK-7.
3. `force_api` tem UPDATE em todas as colunas de `sales_order_approval`; considerar trigger de imutabilidade pós-decisão.

## Divergências / riscos conhecidos
- Fixture de sessão E2E é código de teste (`apps/web/e2e/support/session.ts`, via `docker exec psql` no Postgres descartável), sem endpoint HTTP, para não deixar bypass no produto.
- Pool estrito: gerente decide só o nível gerente, admin só o diretor ("Diretoria"). Sem gerente, pedido de nível gerente fica sem aprovador.
- Envio ao ERP segue desligado (`erp_submission_disabled`): pedido `approved` ainda não vai a lugar nenhum.
- `config-bootstrap` pode sobrescrever limites editados pelo admin; contador do dashboard não conta os novos estados.
- Campo de bloqueio do TSIUSU segue NEEDS VALIDATION (AUTH-13 testado só até o stub).
- Risco aceito: enumeração de usuários na queda do verificador (AUTH-15).
- `.claude/settings.json` recebeu curingas largos (`node *`, `git *`, `docker *`, `cat *`, acceptEdits) a pedido do dono; o aviso automático de segurança foi reconhecido, não aplicado.
- Worktree `C:\Dev\sf-track-b` (branch `feat/track-b`) já integrada; remover quando quiser.

## Só o dono roda
Ver `.claude/work/CURRENT.md`. Nada foi executado em staging, Sankhya ou produção.

## Decisões do dono
Ver CURRENT.md (valores 5/15/30, auto-aprovação, nível sem aprovador, D-1..D-10 do plano SNK-7).
