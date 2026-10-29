# CURRENT

STATUS: ACTIVE — atualizado em 2026-10-29. Fonte de verdade ÚNICA: `C:\Dev\sales-force-evolution` (`feat/sales-force-evolution`, publicada em `origin`). Nada em `main`.

> **Toda sessão do Claude Code abre a partir de `C:\Dev\sales-force-evolution`.** Este repositório é independente (não é worktree do outro). O checkout `C:\Dev\sales-force` (`feat/phase-0-foundation`) fica só até o D12 ser commitado aqui (cherry-pick de `2a836a0`: apenas `apps/web/e2e/**` e os arquivos de pacote, lint, tsconfig e lock; sem `.claude/settings.json` e sem `CURRENT.md`); depois vai para `C:\Dev\_arquivo`.

## Repositórios (auditoria 2026-10-29, `REPO_AUDIT_2026-10-29.md`)

- Arquivado: `C:\Dev\sales-force-evolution-old` → `C:\Dev\_arquivo\sales-force-evolution-old-20261029` (worktree antigo; `f57b2f8` contido aqui; levou `.env`, `deploy/.env` e `debug.keystore` sem abrir).
- Arquivado: `C:\Users\T-GAMER\Desktop\sales-force` → `C:\Dev\_arquivo\sales-force-desktop-20261029` (diff das modificações em `C:\Dev\_arquivo\sales-force-desktop-20261029.diff`).
- Mantido até o D12: `C:\Dev\sales-force`. Seu `deploy/.env` fica intocado. Resta lá um registro de worktree obsoleto (`.git/worktrees/sales-force-evolution`) que o `git worktree prune` não removeu.
- Histórico do Claude Code `~/.claude/projects/C--Dev-sales-force`: mantido, não tocar.
- Staging está em `e705f2f`, 30+ commits atrás deste HEAD; a migration `0012_sales_order_discount_authority` está pendente lá. AUTH-6, PB-1 e DISC-2 ainda não foram para staging.
- Decisões D1–D12 (`02415be`, `docs/decisions.md` §3.14): confirmadas pelo dono em 2026-10-29.
- `gh` não instalado (adiado pelo dono). `dbexplorer-sankhya` tem 40 commits e 47 branches sem remoto (outro projeto, sem ação).

## Decisões do dono (responder cada linha com uma palavra: SIM / NÃO / ADIAR / opção)

| # | Decisão | Opções | Minha recomendação | Se adiar |
|---|---|---|---|---|
| 1 | **PB-1** — `AUTH_MODE` fora de dev (hoje só dev + híbrido temporário) | (a) criar modo não-dev com verificador Sankhya + admin/técnico local; (b) manter híbrido | (a): é o que `AUTH-5`/`ROLE-1` já descrevem; sem isso não há produção | Staging segue no híbrido; produção bloqueada |
| 2 | **SB-1** — compose de staging como artefato versionado | (a) versionar `deploy/docker-compose.staging.yml` + `compose.env.example` como base oficial; (b) manter só na VPS | (a) | Staging só reproduzível pelo que está na VPS |
| 3 | **SB-2** — `eas.json` e package id Android | (a) fixar perfil `staging` e id `com.plac.force` (nome a confirmar por você); (b) esperar a loja | (a) com o id confirmado | Sem build de staging assinado/rastreável |
| 4 | **Emenda STACK-2** (verificador como processo separado com credencial humana) | (a) confirmar que `STACK-2a` (2026-10-02) cobre o verificador atual; (b) emendar de novo | (a) | Doc diz uma coisa, a topologia faz outra |
| 5 | **R35/R36** — base e roteamento da alçada de desconto | (a) base = tabela de preço do cliente, roteamento vendedor→gerente→diretor; (b) outra | (a) | Alçada não imposta no servidor (P-10) |
| 6 | **Login verificado no Sankhya obrigatório para vendedor** | SIM = vendedor nunca entra por senha local; NÃO = permitir exceção | SIM | Contas locais de vendedor poderiam coexistir |
| 7 | **Ferramenta para preencher `external_user_id`** no modo `PRE_LINKED` | **DECIDIDO (b)** — AUTH-7 | Já em (b) de fato: `VERIFIED_AUTO_PROVISION` ligado em staging (2 vendedores `sankhya_auto`); prova idusu ↔ CODUSU feita em 28/10 | — |
| 8 | **Janela de compatibilidade e-mail → username** no `POST /auth/login` | (a) aceitar e-mail por N dias e avisar; (b) cortar já | (b) em staging (poucos usuários), (a) só se houver usuário real com e-mail | Dois formatos ativos; mais superfície de ataque |

## Só o dono roda

Eu não rodo nada que peça senha ou fale com o Sankhya. Cole de volta somente o que está dito em cada bloco. Já colhido e provado: espelho, flags, recusa do GUSTAVO (`docs/sankhya-spike.md` §9.46) e a **prova idusu ↔ CODUSU (§9.47, 28/10, OVERALL PROOF OK)**; não repetir.

### Etapa 4. Campo de bloqueio/inativo de TSIUSU — PENDENTE, sem coleta pronta
Quando você quiser, eu preparo a sonda somente leitura (colunas de TSIUSU e valor para um usuário bloqueado conhecido no Sandbox). Sem isso, a revogação por bloqueio no ERP só vale pelo intervalo do espelho (15 min + 60 s) quando o vínculo some.

### Etapa 6 — CONCLUÍDA em 28/10 (login real do GUSTAVO 12:31:18Z: seller, 1 vínculo, sessão criada)
Opcional: `retry-seller-autoprovision.sh` cobre refresh, logout e novo login, que a evidência colada não mostra.

## Onde paramos (2026-10-28)
- Commits locais (nenhum push): `600a08f`, `597f665`, `7658344`, `24e4092`, `54a9f70`, decisões do dono (`docs/decisions.md` §3.13), SB-2, SB-1, AUTH-8, `95f309e` (teste do harness), `b56cd8a` (sonda) e este fechamento.
- **Staging está com as flags ligadas** (login externo, auto-provisionamento, idusu=CODUSU validado, idade máx. do diretório 120 min). Data de ativação não determinável; hipótese 08/10 ≈ 15:06Z.
- **Prova idusu ↔ CODUSU: PROVADA em 28/10** (spike §9.47). Espelho saudável (68/54 usuários, 83/61 vendedores). Recusa do GUSTAVO = `external_unmapped` única em 07/10. 2 vendedores `sankhya_auto`.
- Etapas 1, 2, 3, 5 e 6 concluídas. Só a 4 (campo de bloqueio de TSIUSU) está pendente; o dono traz do DBExplorer. Pendentes de decisão/plano: emenda STACK-2; planos em slices de PB-1, DISC-2 e AUTH-6.
- Gate local: db 71 verdes; server 1111/1112 e a falha (harness) corrigida em `95f309e`; /products sem cost/margin passou em banco real.

## Por onde retomar
0. **Sessão 2026-10-28 encerrada a pedido do dono.** Ler `.claude/work/CHECKPOINT_2026-10-28.md` (feito, não feito, ordem D1-D12). Último commit: `28b1ceb` (D1). Próximo: D2/D3/D4, depois security-reviewer em `4719d39..1174453`.
1. Plano em slices das decisões 1 (PB-1), 5 (DISC-2) e 6 (AUTH-6), para aprovação antes de codar.
2. Depois, o slice de rascunho offline, cache, outbox e sync (design §8.3/§8.4).
3. Resposta sobre a emenda STACK-2; etapa 4 quando o dono trouxer o campo do DBExplorer (registro em `docs/sankhya-spike.md`).
4. Pedidos ao Sankhya TESTE seguem desligados (SNK-6).

---

## Histórico anterior

- Branch `feat/sales-force-evolution`; nothing pushed, nothing merged.
- Teste de servidor cost/margin em /products escrito em 54a9f70 (ainda não executado); pendente: confirmação do dono sobre a redação do MOB-6.
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

## 2026-10-07 — Login automático de vendedores

- Checkpoint completo: `.claude/work/CHECKPOINT_2026-10-07_seller-auto-login.md` (ler primeiro).
- Staging roda `7d7999b` (migration 0011 aplicada, db-roles OK, serviços saudáveis). Auto-provisionamento estava DESLIGADO em 07/10 e foi ligado depois (ver "Onde paramos"); ligar só após provas (mirror, causa da recusa do GUSTAVO, sonda idusu↔CODUSU, campos de bloqueio). Não repetir o deploy. Pedidos ao Sankhya TESTE: próxima fase, não iniciada.
