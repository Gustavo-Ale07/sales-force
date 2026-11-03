# Checkpoint 2026-11-03 — correção 2 da parte 2 (Q7 tolerante, resumo de escopo)

**Fato (staging 11:04 BRT):** `sync.configuration` = stored (5 alterações), mas `erp.orderStatusDisplay` não aplicada: 8 linhas `status_incomplete` (PERM* NULL no Sandbox).

**F4:** Q7 exige só CODSTATUS e NOME. Cor ausente/inválida = sem cor (`color` opcional em domínio/contrato/openapi). PERM* NULL/N = false, S = true, outro = false + `status_flag_invalid`. Linha sem código/nome = `status_incomplete` com código, só ela descartada; `no_order_status` só sem sobras.
**F5:** relatório do sync com `scope` (contagens + códigos) para negociações e TOPs elegíveis.
**Código:** `packages/sankhya` (mapping, queries, facts, fixture), `apps/server` overlay + sync service, `packages/contracts|domain` (color opcional), testes.
**Falta o dono:** deploy e novo `sync.configuration`.
