# BLOCKERS_PREPROD (trabalho — não commitar) — 2026-10-01

## Nota R35/R36 (não é blocker técnico)
- Autoridade de desconto (R35 base de cálculo; R36 roteamento/teto/substituto): decisão de negócio pendente com o owner. Não bloqueia a finalização técnica (auth, verifier, staging, mobile staging). Intermediário DISC-1 permanece. Não inventar regra.

## BLOCKER-SNK-CREDENTIALS — BLOCKED_EXTERNAL_SECRET (não é bug do Force)
- Mecanismo anterior: `deploy/docker-compose.dev.yml` + serviço `worker` + substituição de `${SANKHYA_*}` a partir de `deploy/.env`; one-off: `docker compose run --rm --no-deps -T --entrypoint "" worker node dist/sync-once.js` com SANKHYA_MODE=live, SYNC_MIRROR_ENABLED=false, sandbox host exportados no shell.
- Reproduzido em 2026-10-01: SANKHYA_CLIENT_ID / CLIENT_SECRET / X_TOKEN chegam EMPTY ao container. Não é rede, TokenProvider ou gateway.
- Política de segurança bloqueou busca de segredos em outros locais; não contornar.
- Impacta: autenticação Sankhya final, fonte das fotos, novas leituras read-only, revalidação de TOP/config/preços no TESTE.
- Ferramenta: `apps/server/.scratch/snk-ro.ts` (excluída do git via .git/info/exclude; só SELECT; sem segredos no código).
- Dívida de compose (separada): `SEED_DEV_PASSWORD` é exigido na interpolação de `deploy/docker-compose.dev.yml` mesmo para `run worker`; não é credencial Sankhya.
