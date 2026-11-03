# Checkpoint 2026-11-03 — Parte 2 fechada (Trilha E)

Decisões do dono de 2026-11-03: `docs/decisions.md` §3.17 (nota de status). Nenhuma chamada ao Sankhya; staging, flags e `compose.env` intocados; nenhum deploy.

## Entregue (um commit por item)
- Decisão `4326d44`: `showCreditLimit` fica no arquivo base; `OCLTLIMCRED` só informativo.
- E1 `2fac9c6`: W-38 "Configurações" (`/configuracoes`, somente leitura, origem por valor, estado do último sync, aviso "Edite no Sankhya"); `ConfigurationSummary` ganhou `erp` e as chaves novas; técnico e administrador veem, vendedor não (CFG-7). W-39 segue oculta.
- E2 `e4dad5e`: status do Sankhya na lista de pedidos e no detalhe, com "pendente: <evento>" (`erp.liberationEventLabels`; sem nome, "evento N").
- E3 `22d61ba`: `docs/implementation/sankhya-configuration-contract.md` reescrito (PONTE/BASE/INFRA + proposta `AD_PLACFORCE*` sem DDL); seção "Configuração lida do Sankhya" em `deploy/README-staging.md`; ordem B do `snk-7-dry-run.md` (registrar o que o Sandbox faz; EXIGELIB = N na TOP 1001, resultado não observado).
- E4 `51de3fa`: só faltava a varredura de credenciais no dry-run e no outbox; o resto (tabela do overlay, fail-closed por tipo de erro, no-op por hash, auditoria, CFG-7, W-38) já estava coberto.
- E5 `574f393`: `.claude/work/PLAC_STAGING_INSTALLATION.json` (2026-11-03) + teste com o mesmo validador do config-bootstrap.

## Reviewer de segurança (único, `993eeec..HEAD`) — sem altos, sem médios
- BAIXO 1: `syncStates[].lastErrorMessage` vai a administrador/técnico sem mudança; confirmar que o escritor grava mensagem classificada e sem credencial/URL (não rastreado pelo reviewer; mesmo ponto do BAIXO 4 do reviewer anterior).
- BAIXO 2: `erpStatus.releaseEvents` (motivo de liberação) aparece no detalhe do pedido para quem lê o pedido, inclusive representante externo se o detalhe for permitido a ele; sem custo/margem (P-20 não violado). Dono confirma se quer mostrar o motivo ao representante.
- BAIXO 3: `showCreditLimit` agora só muda no arquivo base; confirmar que o valor do arquivo é o desejado para vendedores.
- Não coberto: escrita/máscara de `lastErrorMessage`, matriz completa de leitura de pedidos, runtime, migrações 0018/0019 e `db-roles.sql` (revistas na rodada anterior).

## Lacunas conhecidas
- **Mobile (E2):** o app não mostra estágio do Sankhya por desenho (`sales-status.ts`) e o sync não leva `erpStatus`; mostrar no mobile exige mudar o protocolo de sync — NÃO feito (escopo). Decisão do dono.
- Q8, UTILFINANC e OCLTLIMCRED só existem no relatório do worker (logs); a W-38 avisa isso.
