# Checkpoint — correção do espelho de IPI (2026-11-04)

Fato (staging, deploy 2a50aef): `sync-once ipiRates` falhou fechado: `PERCENTUAL` nulo em linha(s) da TGFIPI do Sandbox.

## O que mudou
- **H1 (tolerância por linha):** `PERCENTUAL` nulo = taxa 0,00 com `erp_ipi_rate.rate_missing = true` (migração 0023, só expand). `CODIPI` nulo/não inteiro descarta só a linha (aviso sem valores). `VLRPAUTA` nulo = 0, `PAUTACONDIC` nulo = 'N', `DESCRICAO` nula = ''. O relatório do worker traz um aviso com a contagem e os códigos sem taxa. A checagem de completude da página conta as linhas descartadas.
- **Domínio/contratos/clientes:** novo status `exempt` ("IPI isento/não informado"): 0,00, contado à parte (`exemptLineCount`), não torna o pedido parcial. Web e mobile mostram o aviso.
- **H2:** `openTitles`: `VLRBAIXA` nulo = 0; `DTVENC` ou `VLRDESDOB` nulo = linha descartada com aviso (antes: página rejeitada / linha filtrada no SQL).

## Para o dono (depois do deploy)
1. O deploy aplica a migração 0023.
2. `deploy/scripts/sf-compose.sh exec worker node dist/sync-once.js ipiRates openTitles` e conferir o aviso com contagem/códigos no log do worker.
3. Validar com a área fiscal se taxa nula na TGFIPI significa isento ou não tributado (NEEDS VALIDATION, `docs/sankhya-spike.md` §9.50 item 6).

Nenhuma chamada ao Sankhya foi feita. Staging não foi tocado.
