# CURRENT

STATUS: ACTIVE — S7/V-09 executed 2026-09-30 on SM-M556B; recorded as MOB-6 (docs/decisions.md), evidence in docs/mobile-spike.md §8.

- Branch `feat/sales-force-evolution`; nothing pushed, nothing merged.
- Pending: server test for cost/margin absence in /products endpoints (MEDIUM, mobile-spike §8.6); owner confirmation of MOB-6 wording.
- Next slice: RASCUNHO OFFLINE + CACHE + OUTBOX + SYNC (design §8.3/§8.4). FTS5 unusable (§8.1).

## 2026-10-05 — Login por usuário (híbrido temporário) — NÃO publicado

- Contrato `{username,password}` ponta a ponta (contracts/server/web/mobile); migration 0008 `account.external_user_id` (só local/Testcontainers; nunca aplicada em produção). Admin local preservado; login externo Sankhya **desligado por padrão**, verificador fail-closed, provisionamento restrito de `seller`.
- **Autenticação humana do Sankhya NÃO está concluída:** "Falta definir o mecanismo oficial de autenticação humana do Sankhya." Detalhes: `docs/implementation/auth-username-flow.md`.
- Assets/branding: ver `docs/implementation/web-assets.md`. Sem commit, push, deploy ou alteração de VPS.

## 2026-10-05 — Pré-deploy final (auth, assets, gate local) — NÃO publicado

- Estado: login por `username`; admin local preservado; login externo DESLIGADO (verificador fail-closed); contas externas (`external_user_id`) nunca recebem nem usam senha local; auto-provisionamento DESLIGADO por padrão (`linkMode` `PRE_LINKED`; `VERIFIED_AUTO_PROVISION` só com `EXTERNAL_AUTO_PROVISION=1`, a partir do espelho `erp_directory_user` — ver `docs/implementation/auth-username-flow.md`); piso de latência de falha (`failure-floor.ts`); DTO `Account.username` (coluna física `account.email` = dívida documentada).
- Assets versionados no Git (hero com hash no bundle, `public/brand`); favicon PLAC; título padrão "Force PLAC"; ícones 180/192/512 gerados da marca existente (fonte de 173px, 512 é ampliado); `/manifest.webmanifest` servido como `application/manifest+json`.
- Gate local: contracts 107, domain 282, db 60, web 416, mobile 422, todos com lint/typecheck/build limpos; server 807/808 (única falha: `postgres-harness.test.ts`, teardown sensível à carga, passa isolado 5/5, arquivo não alterado). Imagens `sales-force-{server,web}:localtest` construídas e a web inspecionada/servida localmente. Sem commit, push, deploy ou alteração de VPS.
- Fotos de produto: fonte NÃO provada; ver `.claude/work/sankhya-photo-probe.mjs` (não executado) e as decisões pendentes do dono.
