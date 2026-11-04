# Checkpoint — parte 2b (2026-11-03 a 2026-11-04)

Branch `feat/sales-force-evolution`, base `ef68bee`. Nada em staging, nada ao Sankhya, sem deploy, sem mudar `compose.env`/flags.

## Commits (um por item)

| Item | Hash | O que |
|---|---|---|
| G1 | `f070a69` | IPI estimado nos totais (D-D), só exibição |
| G2 | `08cfc57` | Financeiro do cliente, só leitura (D-I): títulos em aberto, vencidos, limites; migração 0021; tabela `erp_open_title` |
| G3 | `f58c978` | Expedição nasce não marcada, enviada como `AD_EXPEDICAO='N'` (D-O); migração 0022 |
| G4 | `cd0501b` | Máscara de texto de erro (D-Q) e teste de visibilidade do motivo de liberação (D-P) |
| G4 (achado) | `d1ae020` | Máscara cobre qualquer esquema após `Authorization` (Basic, Digest) |
| G5 | `96fbcc6` | Roteiro do dry-run SNK-7 revisado (portadora, `AD_EXPEDICAO`, IPI, campo de origem) |
| G6 | (este commit) | Decisões §3.18, spike §9.50, README-staging, este checkpoint, CURRENT.md |

## Decisões registradas (APPROVED 2026-11-03, `docs/decisions.md` §3.18)

D-D, D-I, D-O, D-P, D-Q, D-R. Fatos do Sandbox em `docs/sankhya-spike.md` §9.50.

## Desenho do D-Q

`observability/mask-error-message.ts` mascara Authorization (qualquer esquema), Bearer, X-Token, chaves token/senha/secret, JWT, `usuário:senha@`, URLs e os hosts/credenciais literais do Sankhya. Os alvos são registrados uma vez pelo worker em `config/worker-env.ts` (único lugar que lê `SANKHYA_*`, fronteira STACK-2 mantida pelo teste `boundaries`). Aplicado em `describeSyncFailure` (sync_state e mídia/configuração) e nas duas gravações de `lastErrorMessage` do outbox.

## Não feito

- Resumo financeiro no mobile (5 campos): não é aditivo trivial (muda o protocolo de sync); registrado em "Decisões do dono".
- Status do Sankhya no mobile (D-R): parte 3.

## Verificação

Servidor: suíte completa 1462 de 1463 passou antes do ajuste de fronteira; a única falha (`boundaries`, `SANKHYA_` fora do código do worker) foi corrigida e os 508 testes unitários passam. Lint e typecheck do servidor limpos. Pacotes anteriores (domain, db, sankhya, contracts, web) verdes nos respectivos commits.

## Reviewer

Parecer único do security-reviewer sobre `ef68bee..HEAD`: aceitável, sem achados ALTOS ou MÉDIOS, sem violação de controle APPROVED. Três BAIXOS, nenhum corrigido (nenhum é falha de autorização):
- B1 `customers.service.ts` `financial()`: `dueDate`, `blockReason` e `situation` dos títulos saem mesmo com `overdueTitles` ou `showCreditLimit` desligados (coerência de exibição por configuração). Decisão do dono: ocultar também ou documentar que os títulos sempre aparecem.
- B2 `MIN_SECRET_LENGTH = 6`: segredo literal curto só é mascarado pela regra de chave. Teórico (credenciais reais são longas).
- B3 alvos da máscara registrados só no worker: se um chamador da API usar `maskStoredError`, valem só os padrões genéricos. Hoje todos os gravadores rodam no worker.
Não coberto pelo reviewer: execução de testes, UI além de grep, queries reais de `mapping.ts`, openapi/snapshots gerados.

Durante o G6 o `check-boundaries` do domain acusou `NUNOTA` em um comentário de `financial.ts`; corrigido (texto neutro) e a verificação passa.
