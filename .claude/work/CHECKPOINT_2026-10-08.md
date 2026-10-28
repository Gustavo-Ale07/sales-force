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
| Espelho `erp_directory_user` (migration 0011), `decideDirectorySeller`, revogação só de `sankhya_auto` | implementado, testado e **populado em staging** (68 usuários, 54 com vendedor; 83 vendedores, 61 ativos; cron 15 min) |
| idusu = Base64 do código decimal do usuário e estável entre logins | observado |
| idusu decodificado == `TSIUSU.CODUSU` | **PROVADO em 28/10** (`prove-idusu-codusu-vps.sh` na VPS, Sandbox, somente leitura; OVERALL PROOF OK; `docs/sankhya-spike.md` §9.47) |
| Coluna de bloqueio/inativo de TSIUSU | **NÃO validada**; revogação ≈ cron do espelho (15 min) + 60 s |
| Causa da recusa do GUSTAVO SOUSA | **provada em 28/10**: `external_unmapped` em 2026-10-07T18:09:18Z, ocorrência única, sem recorrência |
| Flags em staging | **LIGADAS** (login externo, auto-provisionamento, idusu=CODUSU validado, idade máx. do diretório 120 min) — contradiz o CURRENT.md/checkpoint de 07/10; data **não determinável** pelo repo, hipótese 08/10 ≈ 15:06Z |

## Verificação em 2026-10-28 (worktree de evolução)
- `pnpm typecheck` e `pnpm lint`: limpos.
- Testes: domain 292 · contracts 114 · sankhya 223 · mobile-db 137 · web 421 · mobile 37 suítes · **db 71 (Docker ligado)** · **server 1111 de 1112**; a única falha era `postgres-harness.test.ts` (corrida real: o servidor encerra o backend de forma assíncrona), corrigida com polling (`95f309e`) e estável em 5/5 execuções isoladas.
- `products-restricted-data.test.ts` (cost/margin em /products, todos os papéis) passou em banco real: 6 testes.

## O que falta
1. Etapa 4: campo de bloqueio/inativo de TSIUSU (sonda somente leitura, rodada pelo dono).
2. (Opcional) Refresh, logout e novo login do vendedor não estão na evidência de 28/10.
3. Decisão do dono ainda aberta: emenda STACK-2 (STACK-2a cobre o verificador atual?). Demais decididas em `docs/decisions.md` §3.13.
4. Plano em slices das decisões 1 (PB-1), 5 (DISC-2) e 6 (AUTH-6) antes de codar; depois o slice de rascunho offline, cache, outbox e sync.
5. Pedidos ao Sankhya TESTE: próxima fase, não iniciada (SNK-4/SNK-6 intactos).

## Por onde retomar
`CURRENT.md` (tabela de decisões + "Só o dono roda") → rodar server/db → colar saídas das provas → registrar fatos em `docs/sankhya-spike.md`.

## Atualização 2026-10-28 — fatos novos do staging (saídas colhidas pelo dono)
Registro completo em `docs/sankhya-spike.md` §9.46.

Etapas da lista "Próximas etapas" (numeração do dono, 28/10; a tabela anterior desta nota usava outra ordem — ver mapeamento abaixo):
| Etapa | Estado |
|---|---|
| 1. Espelho populado por leitura real do TESTE | **CONCLUÍDA** (68/54 usuários, 83/61 vendedores; cron 15 min; sync-once sem mudanças) |
| 2. Causa da recusa do GUSTAVO | **CONCLUÍDA** (`external_unmapped`, 07/10 18:09:18Z, única) |
| 3. idusu ↔ CODUSU | **PROVADA em 28/10** (VPS, Sandbox, OVERALL PROOF OK; spike §9.47) |
| 4. Campo de bloqueio/inativo de TSIUSU | **PENDENTE** (NEEDS VALIDATION; sem coleta feita) |
| 5. Flags de auto-provisionamento e idusu=CODUSU | **CONCLUÍDA** (ligadas em staging, agora com a prova da etapa 3 por trás; sonda local alinhada à origem OAuth do worker em `b56cd8a`, o script da VPS é a prova de registro) |
| 6. Login real do vendedor com trace | **CONCLUÍDA em 28/10** (GUSTAVO 12:31:18Z: `auth.login.success`, externo, `seller`, 1 vínculo, sessão criada, verificador 200 `verified`; o login das 12:01Z era a conta manager externa, outra conta). Refresh/logout/novo login não aparecem na evidência colada |

Mapeamento da numeração anterior (07/10 e primeira versão desta nota): 4→absorvida na 5, 5→4 (campo de bloqueio), 6→5 (flags), 7→6 (login real).

Último login observado (12:01Z): sucesso, externo, `manager`, 0 vínculos de vendedor, verificador `verified` 200.
Risco que estava aberto (flag idusu=CODUSU ligada antes da prova): **fechado** pela prova formal de 28/10.
