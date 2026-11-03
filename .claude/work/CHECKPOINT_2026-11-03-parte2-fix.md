# Checkpoint 2026-11-03 — correção da parte 2 (Q1 adaptativa)

**Causa:** Q1 pedia `BLOQVENDCLIBLOQ` e `EXIBLIMCRECAR`, inexistentes na `AD_TVDYCFGFRC` do Sandbox (329 colunas; produção 370) → ORA-00904, falha fechada, nada aplicado. Os exports de 30/10 eram todos da produção (corrigido no spike §9.49 e no CONFIG_MAP).

**F1:** discovery em `USER_TAB_COLUMNS` + `buildQ1()` (interseção com lista fixa). 7 colunas obrigatórias (ausente → `configuration_column_missing` nomeando a coluna); informativas ausentes → aviso `column_missing`. Nunca `SELECT *`; sem coluna de credencial.
**F2:** falha `sql_error` mostra `Q1 (sql_error: ORA-00904)` (só código ORA + nome da consulta) no relatório e em `sync_state`.
**F3:** só investigação (ver CURRENT.md, seção "Correção da parte 2"). Espelhos parados porque `SYNC_MIRROR_ENABLED=false` deixa só sellers/directoryUsers agendados. Nenhuma mudança de agenda.

**Código:** `packages/sankhya` (configuration-queries, real-gateway, configuration-facts, fixture, index), `apps/server/src/configuration/sankhya-overlay.ts` + testes.
**Falta o dono:** redeploy desta correção e rodar `sync.configuration` de novo (esperado: `stored` com 2 avisos `column_missing`); depois os `sync-once` dos espelhos.
