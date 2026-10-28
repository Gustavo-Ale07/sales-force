# CURRENT

STATUS: ACTIVE — retomada em 2026-10-28. Fonte de verdade: este worktree (`feat/sales-force-evolution`). Nada enviado (sem push), nada em `main`.

> Checkout antigo `C:\Dev\sales-force` (branch `feat/phase-0-foundation`): guarda só a suíte Playwright de 21/09 como WIP pré-pivô (commit `2a836a0` lá). Não migrada para cá; não retomar.

## Decisões do dono (responder cada linha com uma palavra: SIM / NÃO / ADIAR / opção)

| # | Decisão | Opções | Minha recomendação | Se adiar |
|---|---|---|---|---|
| 1 | **PB-1** — `AUTH_MODE` fora de dev (hoje só dev + híbrido temporário) | (a) criar modo não-dev com verificador Sankhya + admin/técnico local; (b) manter híbrido | (a): é o que `AUTH-5`/`ROLE-1` já descrevem; sem isso não há produção | Staging segue no híbrido; produção bloqueada |
| 2 | **SB-1** — compose de staging como artefato versionado | (a) versionar `deploy/docker-compose.staging.yml` + `compose.env.example` como base oficial; (b) manter só na VPS | (a) | Staging só reproduzível pelo que está na VPS |
| 3 | **SB-2** — `eas.json` e package id Android | (a) fixar perfil `staging` e id `com.plac.force` (nome a confirmar por você); (b) esperar a loja | (a) com o id confirmado | Sem build de staging assinado/rastreável |
| 4 | **Emenda STACK-2** (verificador como processo separado com credencial humana) | (a) confirmar que `STACK-2a` (2026-10-02) cobre o verificador atual; (b) emendar de novo | (a) | Doc diz uma coisa, a topologia faz outra |
| 5 | **R35/R36** — base e roteamento da alçada de desconto | (a) base = tabela de preço do cliente, roteamento vendedor→gerente→diretor; (b) outra | (a) | Alçada não imposta no servidor (P-10) |
| 6 | **Login verificado no Sankhya obrigatório para vendedor** | SIM = vendedor nunca entra por senha local; NÃO = permitir exceção | SIM | Contas locais de vendedor poderiam coexistir |
| 7 | **Ferramenta para preencher `external_user_id`** no modo `PRE_LINKED` | (a) script de admin lendo o espelho `erp_directory_user`; (b) ligar `VERIFIED_AUTO_PROVISION` depois das provas; (c) nada | (b) após as provas do item "Só o dono roda"; (a) só se (b) falhar | Vendedores seguem recebendo 403 `access_not_configured` |
| 8 | **Janela de compatibilidade e-mail → username** no `POST /auth/login` | (a) aceitar e-mail por N dias e avisar; (b) cortar já | (b) em staging (poucos usuários), (a) só se houver usuário real com e-mail | Dois formatos ativos; mais superfície de ataque |

## Só o dono roda

Eu não rodo nada que peça senha ou fale com o Sankhya. Cole de volta somente o que está dito em cada bloco.

### 1. Prova idusu ↔ CODUSU (terminal local, Sandbox, somente leitura)
```
cd C:\Dev\sales-force-evolution
node .claude/work/sankhya-idusu-proof.mjs
```
Pede as senhas em prompt oculto. **Cole de volta:** tudo que o script imprime (só códigos e SIM/NÃO; nunca senha, token ou nome).
Alternativa na VPS (mesma prova, dentro dos containers): `sudo bash prove-idusu-codusu-vps.sh` — **cole** o bloco D (resultado).

### 2. Diagnóstico do espelho (VPS, somente leitura)
```
cd <pasta com .claude/work copiada para a VPS>
sudo bash check-directory-mirror.sh
```
**Cole de volta:** a saída inteira (migration 0011 sim/não, contagens e data da última sincronização do espelho, valores das 4 chaves `EXTERNAL_*`).

Se o espelho estiver vazio ou velho (única etapa que lê o Sandbox e grava só as tabelas do espelho):
```
sudo bash sync-sellers-directory-users-once.sh
sudo bash check-directory-mirror.sh
```
**Cole:** a saída do segundo comando.

### 3. Recusa do GUSTAVO SOUSA (VPS, somente leitura)
```
sudo bash trace-sup-login.sh
docker compose -p salesforce-staging exec -T postgres sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off' < staging-login-diagnosis.sql
```
(depois de o GUSTAVO tentar entrar uma vez). **Cole de volta:** as seções 1, 2 e 3 do SQL (motivos de falha por contagem, recusas de diretório com `user_code`/`seller_code`) e o resumo do `trace-sup-login.sh`. Não cole e-mails, hashes nem tokens (o script já não os imprime).

## Onde paramos (2026-10-28)
- Commits locais desta sessão: `600a08f` (settings), `597f665` (arquivos soltos 07–08/10), `7658344` (senha fora do argv dos scripts), `24e4092` (checkpoint 08/10), `54a9f70` (teste cost/margin em /products). Nenhum push.
- Código: HEAD funcional de 08/10 (`1ed8db3`, `e705f2f`). Gate sem Docker: typecheck/lint limpos; domain 292, contracts 114, sankhya 223, mobile-db 137, web 421, mobile 37 suítes verdes. **server e db não rodados (Docker Desktop desligado)**; o teste novo de /products nunca executou.
- Não provado: idusu == CODUSU; campo de bloqueio de TSIUSU; causa da recusa do GUSTAVO; população real do espelho. Auto-provisionamento segue DESLIGADO.
- Detalhes: `CHECKPOINT_2026-10-08.md` e `CHECKPOINT_2026-10-07_seller-auto-login.md`.

## Por onde retomar
1. Ligar Docker Desktop e rodar `pnpm --filter @salesforce/server test` e o teste do db; corrigir o teste novo se algum papel receber status inesperado.
2. Você responde a tabela e roda os blocos "Só o dono roda"; cola as saídas.
3. Com as provas: registrar fatos em `docs/sankhya-spike.md`; só então (com sua ordem) ligar `EXTERNAL_IDUSU_IS_CODUSU_VALIDATED` e `EXTERNAL_AUTO_PROVISION` em staging.
4. Próxima fatia depois disso: rascunho offline + cache + outbox + sync (design §8.3/§8.4); pedidos ao Sankhya TESTE seguem desligados (SNK-6).

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
- Staging roda `7d7999b` (migration 0011 aplicada, db-roles OK, serviços saudáveis). Auto-provisionamento DESLIGADO; ligar só após provas (mirror, causa da recusa do GUSTAVO, sonda idusu↔CODUSU, campos de bloqueio). Não repetir o deploy. Pedidos ao Sankhya TESTE: próxima fase, não iniciada.
