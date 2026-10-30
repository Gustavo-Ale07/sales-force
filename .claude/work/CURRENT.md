# CURRENT

STATUS: ACTIVE — atualizado em 2026-10-29. Fonte de verdade ÚNICA: `C:\Dev\sales-force-evolution` (`feat/sales-force-evolution`, publicada em `origin`). Nada em `main`.

> **Toda sessão do Claude Code abre a partir de `C:\Dev\sales-force-evolution`.** Este repositório é independente (não é worktree do outro). O checkout `C:\Dev\sales-force` (`feat/phase-0-foundation`) fica só até o D12 ser commitado aqui (cherry-pick de `2a836a0`: apenas `apps/web/e2e/**` e os arquivos de pacote, lint, tsconfig e lock; sem `.claude/settings.json` e sem `CURRENT.md`); depois vai para `C:\Dev\_arquivo`.

## Repositórios (auditoria 2026-10-29, `REPO_AUDIT_2026-10-29.md`)

- Arquivado: `C:\Dev\sales-force-evolution-old` → `C:\Dev\_arquivo\sales-force-evolution-old-20261029` (worktree antigo; `f57b2f8` contido aqui; levou `.env`, `deploy/.env` e `debug.keystore` sem abrir).
- Arquivado: `C:\Users\T-GAMER\Desktop\sales-force` → `C:\Dev\_arquivo\sales-force-desktop-20261029` (diff das modificações em `C:\Dev\_arquivo\sales-force-desktop-20261029.diff`).
- Arquivado em 2026-10-29 (D12 commitado em `5ce650a`): `C:\Dev\sales-force` → `C:\Dev\_arquivo\sales-force-20261029` (nada apagado; `deploy/.env` foi junto, sem abrir).
- Histórico do Claude Code `~/.claude/projects/C--Dev-sales-force`: mantido, não tocar.
- Staging está em `e705f2f`, 30+ commits atrás deste HEAD; a migration `0012_sales_order_discount_authority` está pendente lá. AUTH-6, PB-1 e DISC-2 ainda não foram para staging.
- Decisões D1–D12 (`02415be`, `docs/decisions.md` §3.14): confirmadas pelo dono em 2026-10-29.
- `gh` não instalado (adiado pelo dono). `dbexplorer-sankhya` tem 40 commits e 47 branches sem remoto (outro projeto, sem ação).

## Onde paramos (2026-10-29)
- Trilhas A (auth) e B (alçada de desconto) concluídas e publicadas em `origin/feat/sales-force-evolution`; Trilha C = plano `docs/implementation/snk-7-order-submission-plan.md`. Hashes e achados: `.claude/work/CHECKPOINT_2026-10-29.md`.
- Staging continua em `e705f2f` (híbrido; nada mudou lá). Pendentes no staging: migrations 0012 e 0013 (0013 cria tabela nova, então rodar `db-roles`) e o web com CSP `style-src 'unsafe-inline'`.

## Por onde retomar (2026-10-29)
1. Dono executa o deploy e a troca para `external` (abaixo) e traz os resultados.
2. Itens abertos do checkpoint: 3 achados baixos, valores reais dos limites, regra de auto-aprovação, regra para nível sem aprovador.
3. Plano SNK-7: responder D-1..D-10 no próprio documento; depois fatias S1-S10 (S7 depende de `recomputeOrderAuthority`, já pronta).
4. Próxima sessão: acabamentos de `docs/mobile-spike.md` §8.8 (MOB-8), campo de bloqueio do TSIUSU, fase B (SNK-8) só como plano.

## Só o dono roda — deploy e troca para AUTH_MODE=external (JÁ EXECUTADOS em 2026-10-29; procedimento corrigido em A2)

Fatos de 2026-10-29 (`docs/decisions.md` §3.16): deploy de `bd6d593` por `deploy-staging.sh` como force-deploy com `SF_RUN_DB_ROLES=1`; migrations 0012/0013 aplicadas; `DEPLOYED_SHA=bd6d593`; staging em `API_AUTH_MODE=external` + `WEB_AUTH_MODE=standard` desde 2026-10-29 19:14Z, com `EXTERNAL_LOGIN_ENABLED=1`, `VERIFIER_MODE=live`, `EXTERNAL_AUTO_PROVISION=1`, `EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1`. A 1a tentativa falhou no health do web: nginx `open() /etc/nginx/conf.d/default.conf failed (13: Permission denied)` (checkout com umask 077 deixou `default.conf` 0600 e o `COPY` preservou o modo); corrigido na mão (`chmod 644`) e em definitivo no A2 (`Dockerfile.web` com `--chmod=0644`, `umask 022` e checagem prévia em `deploy-staging.sh`).

Caminhos reais na VPS (NÃO `/etc/salesforce/staging`): repo `/opt/force-staging/repo`; `compose.env` em `/opt/force-staging/config/compose.env`; segredos `/opt/force-staging/config/secrets/*.env`; logs/estado `/opt/force-staging/logs`; usuário `force-deploy`; `SF_EDGE_MODE=external`, `SF_DB_MODE=self-hosted`.

**Próximos deploys** (na VPS, como `force-deploy`): `deploy/scripts/deploy-staging.sh <SHA-40-hex>` (`SF_RUN_DB_ROLES=1` quando a release criar tabela). Qualquer `docker compose` manual passa por `deploy/scripts/sf-compose.sh` (mesmo projeto, arquivos, overlay external-edge, profile e tags de `DEPLOYED_SHA`; `--print` mostra o comando sem executar):
```sh
cd /opt/force-staging/repo
deploy/scripts/sf-compose.sh --print up -d --no-deps --force-recreate api web
deploy/scripts/sf-compose.sh up -d --no-deps --force-recreate api web
deploy/scripts/sf-compose.sh --profile ops-admin run --rm db-roles
curl -fsS https://$STAGING_DOMAIN/api/v1/ready
```
Armadilhas do compose manual (29/10): tag velha `62f50b18b4dc` lida do `compose.env`; sem o overlay `docker-compose.staging.external-edge.yml` não existem as portas loopback `127.0.0.1:13000`/`18080` e o proxy responde 502.

Histórico da troca para `external` (já feita; mantido como referência; Q4 admin local e Q3 revoke):

**(2) Troca para `AUTH_MODE=external`** (só depois do (1) com /ready 200 e do admin local confirmado):
- Mesmo `VERIFIER_SHARED_SECRET` (>= 32 caracteres) em `api.env` e `verifier.env`; `api.env` sem `ALLOW_DEV_AUTH` e sem `SF_ALLOW_DEMO_ACCOUNTS`.
- `compose.env`: `API_AUTH_MODE=external`, `WEB_AUTH_MODE=standard`, `EXTERNAL_LOGIN_ENABLED=1`, `VERIFIER_MODE=live`, `VERIFIER_SANKHYA_BASE_URL=<Sandbox>`, `VERIFIER_EGRESS_NETWORK=verifier_egress`; manter `EXTERNAL_AUTO_PROVISION` como está hoje.
- `deploy/scripts/sf-compose.sh up -d --no-deps --force-recreate api web`; depois `curl -fsS https://$STAGING_DOMAIN/api/v1/ready`.
- Revoke opcional (Q3), UMA vez, com janela combinada e o backup do passo (1):
```sql
BEGIN;
UPDATE session SET revoked_at = now()
 WHERE revoked_at IS NULL
   AND account_id IN (SELECT id FROM account WHERE role = 'seller' AND external_user_id IS NULL)
RETURNING id;
-- conferir a contagem; se não for a esperada: ROLLBACK;
COMMIT;
```

**(3) Validação**
1. `/api/v1/ready` 200.
2. Login do admin local (usuário e senha locais).
3. Seu login como vendedor (usuário do Sankhya).
4. Tela admin de limites de desconto (W-39): conferir 5/15/30 marcados "ajustar pelo dono".
5. Como vendedor, criar pedido com desconto acima de 5% (até 15%) e enviar: fica "aguardando aprovação" (o envio ao ERP segue desligado; 409 `erp_submission_disabled` é esperado).
6. Fila W-20 (`/aprovacoes`): o pedido aparece para o SUP (gerente externo já existente); o SUP aprova.
7. Auditoria mostra quem aprovou, quando e o nível; o vendedor vê o estado no pedido (web) e no app (M-14).
8. Negativo: desconto acima de 15% exige "Diretoria" (admin); acima de 30% fica bloqueado.

**(4) Rollback**
- Modo: `API_AUTH_MODE=local`, `WEB_AUTH_MODE=local`, `EXTERNAL_LOGIN_ENABLED=0`, recriar `api` e `web`.
- Versão: `deploy/scripts/rollback-staging.sh <SHA-anterior>` (ele ajusta as tags; `sf-compose.sh` ignora tags do `compose.env`). As migrations 0012/0013 são expand-only e não são revertidas; a versão antiga convive com elas. Restore do dump só para desfazer migration ruim (README-staging, "Rollback" e "Backup and restore").

## O que ainda depende do dono
- Executar (1)-(3); trazer os valores reais dos limites (hoje 5/15/30 provisórios).
- Regra de auto-aprovação (achado baixo 1) e regra quando não há aprovador do nível.
- Campo de bloqueio de TSIUSU (DBExplorer) para ativar AUTH-13 de verdade.
- Plano SNK-7: decisões D-1..D-10 e autorização do primeiro teste real no Sandbox (a flag `SANKHYA_ORDER_WRITE_ENABLED` fica desligada).
- Anteriores: emenda STACK-2 (decisão 4), SB-2 (`eas.json`), pedidos ao Sankhya TESTE desligados (SNK-6).

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
