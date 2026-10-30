# Checkpoint 2026-10-30 — Parte 2 (parcial)

Decisões: `docs/decisions.md` §3.17 (CFG-8, U-10-a..d, U-11); fatos em `docs/sankhya-spike.md` §9.49. Tudo desligado por padrão (`CONFIG_SYNC_FROM_SANKHYA=0`); nenhuma chamada ao Sankhya; staging intocado.

## Entregue
- D0 `f29380d` (prompt + mapa) · decisões `0f35c03`, `a01f209`.
- D1 `6a70213`: contrato (source.base, provenance, chaves novas opcionais; hash ignora `readAt`/`syncedAt` via `configurationHashView`).
- D2 `858cb73`: `readConfigurationFacts()` (Q1–Q8 literais, fake com valores da PLAC, teste de colunas de credencial). O método antigo `readConfiguration()` (arquivo base) segue existindo.
- D6b `2e63a28`: `orders.erp_status_detail` (migração 0018) com eventos TSILIB.
- D3/D4 `8985a3f`: job `sync.configuration` (15 min + start, só com a flag), overlay base ⊕ PONTE, fail-closed + `sync_state` entity `configuration`, auditoria com chaves alteradas, `--once`, grants em `db-roles.sql`, `provenance` só em `GET /configuration` (admin/técnico).
- Reviewer: `dcd425e` migração 0019 (trigger: versão armazenada nunca volta a `is_current`) e `scopeChanges` na auditoria. Ajustes de teste: `f100f38`, `86f04ee`.

## Reviewer de segurança (único, `df923a8..HEAD`) — sem altos
- MÉDIO 1 (overlay amplia escopo só por flag do Sankhya; sem `topAllowlist` entram as 7 TOPs, tipos novos ficam vendáveis): **decisão do dono** — contradiz U-10-c/U-10-d aprovados se for obrigatório. Mitigado: auditoria registra códigos acrescentados/removidos. Recomendação: manter `sales.topAllowlist` [1000, 1001] no arquivo base antes de ligar a flag.
- MÉDIO 2 (`showCreditLimit` vem de `OCLTLIMCRED`): auditado em `scopeChanges`; dono confirma que o Sankhya manda nessa flag.
- MÉDIO 3 (force_worker pode inserir versão e mudar `is_current`): corrigido por trigger 0019; UPDATE segue só da coluna `is_current`.
- BAIXOS: (4) mensagens de erro do Sankhya em `sync_state` só têm máscara de URL; (5) confirmar que issues do validador não carregam valores; (6) `provenance` sem limite de chaves.
- Não coberto pelo reviewer: SQL da 0018, `order-erp-status.service`/`release-events` (exposição a vendedor), `sync-once.ts` em staging.

## WIP / próxima sessão (D4–D8)
D5 web W-38 (somente leitura, origem por valor, estado do sync) · D6 documentos (`sankhya-configuration-contract.md` reescrito PONTE/BASE/INFRA + AD_PLACFORCE* sem DDL; seção README-staging "Configuração lida do Sankhya") · D7 testes restantes (CFG-7 já coberto em parte; varredura de strings de credencial em outbox/dry-run/logs) · UI de `erp_status_detail`/`erp.liberationEventLabels` · D8 reviewer final. `docs/implementation/snk-7-dry-run.md`: ordem B vira "registrar o que o Sandbox faz".

## Pendências do dono
Ver CURRENT.md "Só o dono roda — parte 2". Também: decidir MÉDIO 1 e 2 acima.
