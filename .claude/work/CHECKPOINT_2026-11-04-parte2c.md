# Checkpoint 2026-11-04 — parte 2c (PARCIAL: J1 e J2 prontos; J3, J4 e D-V 3-5 pendentes)

## Feito (commits na branch)
- J1 comporta por ambiente de implantação: `7985c4b` (código), `ef0234a` (docs/override). `SF_DEPLOY_ENVIRONMENT`; detalhes em `CHECKPOINT_2026-11-04-comporta-ambiente.md`.
- Decisões D-S..D-W + J1 como APPROVED: `134141d` (`docs/decisions.md` §3.19).
- J2 / D-V 1-2: `1643370`. Filtro de mobilidade aplicado no espelho de produtos (`mobilityAllowedValues` no `ReadScope`, cláusula `AND AD_MOBILIDADE IN ('S')` na leitura, mesmo comportamento no gateway falso); `deriveReadScope` só pede quando o filtro está `enforced` + `validated`. Arquivo base `plac-staging-2026-11-04`: filtro `enforced`/`validated`, `productWithoutPrice.visible=false`, sem `topAllowlist` nem `negotiationTypeExclusions` (o overlay já trata ausente = todas as TOPs de pedido do Sankhya e todos os tipos de negociação ativos com AD_MOBILIDADE='S').

## NÃO feito (nada disto foi iniciado; sem código pela metade)
- J2 resto: contagem "fora por mobilidade" no relatório do sync de produtos (hoje o filtro é na origem, então a contagem exige uma consulta de contagem extra); verificação ponta a ponta de busca/lançamento múltiplo/importação/detalhe web+mobile+SQLite; pedido já salvo com produto sem preço continua abrindo.
- J3: rótulos orçamento × pedido pela TOP (web, mobile, PDF), remoção dos textos do carrinho, "Converter em pedido" (a: no lugar; b: `convert_quote` no outbox com TGFVAR e `SelecaoDocumentoSP.faturar` NEEDS VALIDATION; criação do pedido ligado e divergências; c: rótulo "CONVERTIDO EM PEDIDO" em `mapErpOrderStatus`).
- J4: novo template único de PDF (web e mobile) e `brand.company` no arquivo base.
- D-V 4-5: `customers.eligibility` (ativo, CLIENTE, CLASSIFICMS='R' — hipótese) aplicado pelo gateway com colunas descobertas por `USER_TAB_COLUMNS`; transportadoras `TRANSPORTADORA='S'` e `ATIVO='S'`; relatórios com contagem por critério; critérios como fatos a validar no spike. Seletor de TOP com `DESCROPER` e padrão `AD_CODTIPOPERPAD` já vem do overlay (verificar na tela).

## Só o dono roda (nesta ordem)
1. Deploy do SHA novo (sem tabela nova nesta parte: `SF_RUN_DB_ROLES=1` não é necessário).
2. Copiar o arquivo base novo (`plac-staging-2026-11-04`) para `/opt/force-staging/config/installation.json` e rodar `config-bootstrap`.
3. `deploy/scripts/sf-compose.sh exec worker node dist/sync-once.js sync.configuration products` e conferir no log; produtos fora da mobilidade ficam inativos no espelho.
4. Conferir no web: busca "forminha" só com mobilidade e preço; seletor de TOP e tipos de negociação listados direto do Sankhya.
5. Dry-run: criar `/opt/force-staging/config/compose.write-sandbox.yml` (bloco dry_run de `docs/implementation/snk-7-dry-run.md` §5.1) e recriar api+worker com `-f` (qualquer deploy sem `-f` desliga).
6. Decidir antes do AUTORIZO: valor de revendedor em `CLASSIFICMS` (hipótese 'R'); devoluções 23/24 (desligar Mobilidade no Sankhya); orçamento do teste #3 (conversão), dentro dos 40 pedidos ou próprio.
