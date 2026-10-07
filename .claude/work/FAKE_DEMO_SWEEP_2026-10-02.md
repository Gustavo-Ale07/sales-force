# FAKE_DEMO_SWEEP_2026-10-02 (nota de trabalho, não commitar)

Escopo: código não-teste de `apps/*/src`, `packages/*/src`, `deploy/`, config raiz (sem node_modules/dist). HEAD 555243a.
Buscas: demo, fake, seed, mock, placeholder, localhost/127.0.0.1/10.0.2.2/192.168, AUTH_MODE dev, ALLOW_DEV_AUTH, ALLOW_FAKE_GATEWAY, vendedores 101/103/107, TODO/FIXME, credenciais hardcoded.
Resultado das buscas específicas: `10.0.2.2` zero ocorrências; `101/103/107` só em `packages/sankhya/src/fake/*`; TODO/FIXME de produção zero (1 falso positivo "TODOS OS PASSOS OK" em tela DEV); credenciais hardcoded em código não-teste zero (únicos literais: senha throwaway do Postgres dev em compose dev/seed e keystore debug gerado, git-ignored).
Classes: TEST_ONLY · DEV_ONLY · DOC · LEGITIMATE · STAGING_BLOCKER · PRODUCTION_BLOCKER.

## Verificação de alcançabilidade sob NODE_ENV=production + AUTH_MODE=local + compose staging

| Caminho dev-only | Por que é inalcançável (código lido) |
|---|---|
| `AUTH_MODE=dev` | `api-env.ts:117-124`: dev + production => erro de boot; dev exige `ALLOW_DEV_AUTH=1`; `api-env.ts:125-128`: `local` + `ALLOW_DEV_AUTH` definido => erro. Compose staging `:100` exige `API_AUTH_MODE` explícito e não repassa `ALLOW_DEV_AUTH`. Teste: `apps/server/test/unit/env.test.ts`, `integration/auth-local-mode.test.ts`. |
| Origens localhost (`DEVELOPMENT_ALLOWED_ORIGINS`) | `api-env.ts:86-91`: em production `ALLOWED_ORIGINS` é obrigatório; a lista dev só vale fora de production. Compose staging `:102` define `https://${STAGING_DOMAIN}`. |
| Seed / contas demo | `config/seed-env.ts:24-27`: seed recusa `NODE_ENV=production` e DB não-loopback; compose staging nunca invoca `dist/seed.js` nem combina `docker-compose.seed.yml`. `main-api.ts:26` + `platform/demo-accounts-check.ts`: em production, conta `*.demo.salesforce.local` OU falha na verificação => recusa subir (fail closed), salvo `SF_ALLOW_DEMO_ACCOUNTS=true` (ausente no compose). Teste: `integration/demo-accounts-check.test.ts` (10 casos). |
| Gateway fake | `worker-env.ts:95-103`: production exige `SANKHYA_MODE` explícito; `fake` exige `ALLOW_FAKE_GATEWAY=1`. ATENÇÃO: compose staging `:142-143` define `SANKHYA_MODE:-fake` e `ALLOW_FAKE_GATEWAY:-1` por padrão, ou seja, o staging sobe com dados sintéticos por default (permitido por SNK-3, mas o opt-in explícito vira implícito; ver A2). |
| Login operacional / externo | `auth-config.ts:92`: `local` => `allowedRoles=['admin']`; `auth-config.ts:47` `externalLogin` indefinido em todo runtime real; `auth.controller.ts` sem rota external (grep vazio); teste `auth-local-mode.test.ts` "exposes no external login route". |
| `/_design` (web) | `apps/web/src/router.tsx:178` só registra com `import.meta.env.DEV`; ausente do build de produção. |
| Banner "dev" (web) | `dev-auth-banner.tsx:9` só com `authMode==='dev'`; `runtime-config.ts:26,42` cai em `dev` se config.json faltar/ inválido (efeito apenas visual; autorização é do servidor). nginx `40-runtime-config.sh` exige `WEB_AUTH_MODE` e aceita `local`. |
| Mobile S7 / cleartext | `App.tsx:32` exige `EXPO_PUBLIC_S7_DIAGNOSTICS=1` em tempo de build; `plugins/with-dev-cleartext.js` falha o prebuild sem `SF_ALLOW_CLEARTEXT=1`+`SF_BUILD_PROFILE=dev`. Fora do boot de staging (servidor). |

Conclusão: nenhum caminho dev-only é alcançável com NODE_ENV=production + AUTH_MODE=local + settings do compose staging, exceto o gateway fake, que é permitido (SNK-3) e rotulado na UI ("Demonstração").

## Tabela de achados

| # | Arquivo:linha | Achado | Classe | Nota |
|---|---|---|---|---|
| 1 | apps/server/src/config/api-env.ts:42-43,117-128 | `AUTH_MODE` default `dev`, `ALLOW_DEV_AUTH` | DEV_ONLY | refusado em production; ver tabela acima |
| 2 | apps/server/src/config/api-env.ts:79-90 | origens `localhost:5173/4173` | DEV_ONLY | production exige `ALLOWED_ORIGINS` |
| 3 | apps/server/src/config/api-env.ts:25 | `API_HOST` default 127.0.0.1 | LEGITIMATE | compose staging define 0.0.0.0 |
| 4 | apps/server/src/platform/demo-accounts-check.ts:5-75 | verificação de contas demo | LEGITIMATE | guard fail-closed (LOW-1) |
| 5 | apps/server/src/main-api.ts:26 | `SF_ALLOW_DEMO_ACCOUNTS` override | LEGITIMATE | opt-in explícito com aviso; não está no compose staging (poderia ser injetado via api.env: proibir no runbook) |
| 6 | apps/server/src/seed.ts, config/seed-env.ts | seed de contas demo | DEV_ONLY | recusa production e DB remoto |
| 7 | deploy/Dockerfile.server:3,36-41 | imagem contém `dist/seed.js` e `account-cli.js` | LEGITIMATE | seed protegido por guards; account-cli necessário p/ 1º admin |
| 8 | apps/server/src/config/worker-env.ts:95-103; packages/sankhya/src/factory.ts:58-59 | default fake do gateway | LEGITIMATE | guard F7 em production |
| 9 | deploy/docker-compose.staging.yml:142-143 | `SANKHYA_MODE:-fake`, `ALLOW_FAKE_GATEWAY:-1` default | LEGITIMATE | SNK-3 permite fake em staging; recomendação A2 (tornar explícito) |
| 10 | packages/sankhya/src/fake/demo-data.ts, prng.ts, fake-gateway.ts | dataset sintético | DEV_ONLY | só via `SANKHYA_MODE=fake` |
| 11 | packages/sankhya/src/fake/demo-configuration.ts:9-11,39-41,59 | vendedores 101/103/107, e-mails demo, `demoMetrics:true` | DEV_ONLY | `demoMetrics` não é consumido em lugar nenhum de src (apenas declarado) |
| 12 | packages/sankhya/src/fake/accounts.ts:13-25 | e-mails `*.demo.salesforce.local` (sem senha) | DEV_ONLY | senha só no seed via `SEED_DEV_PASSWORD` sem default |
| 13 | packages/sankhya/src/index.ts:16-33 | exports DEMO_*/FakeGateway no barrel | DEV_ONLY | empacotado, só usado por seed/worker fake |
| 14 | packages/sankhya/src/gateway.ts:21-22; real/real-gateway.ts:61,89 | tipos `fake`/`demo` | LEGITIMATE | |
| 15 | apps/server/src/dashboard/dashboard.service.ts:46-108 | `demo: false` | LEGITIMATE | |
| 16 | apps/server/src/orders/*, platform/*, sync/*, domain/erp-eligibility.ts | menções a fake/demo em comentários e `DATASET_ORIGINS` | LEGITIMATE | elegibilidade ERP recusa fake/legacy |
| 17 | apps/server/src/iam/account.service.ts:40 | "placeholder" = vendedor 0 | LEGITIMATE | |
| 18 | apps/server/src/observability/logger.ts:39 | `REDACTED_PLACEHOLDER` | LEGITIMATE | |
| 19 | apps/web/src/router.tsx:178-187; routes/design.tsx | `/_design` | DEV_ONLY | `import.meta.env.DEV` |
| 20 | apps/web/src/components/dev-auth-banner.tsx:9; lib/runtime-config.ts:26,42 | banner dev / fallback `dev` | DEV_ONLY | só visual |
| 21 | apps/web/src/routes/integration.tsx:48,56,110; components/integration-pill.tsx:16; routes/dashboard.tsx:178-181 | rótulos "Demonstração" | LEGITIMATE | rotulagem verdadeira do dado sintético |
| 22 | apps/web/vite.config.ts:6 | proxy 127.0.0.1:3000 | DEV_ONLY | |
| 23 | apps/web/src/routes/*.tsx, components/*.tsx, packages/ui/src/components/* | `placeholder=` de inputs / skeleton | LEGITIMATE | texto de ajuda de UI |
| 24 | apps/mobile/App.tsx:19-22; src/config.ts:27 | exemplo `192.168.0.10` em mensagem | DOC | texto de ajuda; https exigido fora de __DEV__ |
| 25 | apps/mobile/App.tsx:8,32; src/dev/s7-diagnostics-screen.tsx | tela S7 | DEV_ONLY | flag de build opt-in |
| 26 | apps/mobile/plugins/with-dev-cleartext.js | cleartext p/ build dev | DEV_ONLY | fail-closed |
| 27 | apps/mobile/src/test-doubles.ts | doubles | TEST_ONLY | importado só por `*.test.*` |
| 28 | apps/mobile/android/app/build.gradle:100-115 | release assinado com debug keystore (senha `android`) | DOC | diretório git-ignored (gerado); pré-requisito de distribuição, não do boot de staging |
| 29 | deploy/docker-compose.dev.yml:4,19,28,71-72,112,146 | AUTH dev, senha throwaway, fake, localhost | DEV_ONLY | |
| 30 | deploy/docker-compose.seed.yml | overlay de seed | DEV_ONLY | `SEED_DEV_PASSWORD` sem default |
| 31 | deploy/README.md:27,56 | "conta demo semeada", localhost | DOC | escopo dev |
| 32 | deploy/docker-compose.staging.yml:127.0.0.1 (healthchecks), staging/Caddyfile:9 | loopback interno | LEGITIMATE | |
| 33 | deploy/docker-compose.staging.yml:98-99,174 (comentários); deploy/staging/compose.env.example:22-24 | "só dev existe / cannot boot", `API_AUTH_MODE=REPLACE_WITH_PRODUCTION_AUTH_MODE`, `WEB_AUTH_MODE=standard` | DOC | desatualizado vs `AUTH_MODE=local`; placeholder falha rápido (enum), não é vazamento |
| 34 | deploy/README-staging.md (inteiro) | não documenta criação do 1º admin | STAGING_BLOCKER | runbook: sem seed, o único caminho é `node dist/account-cli.js create --role admin` com `ALLOW_REMOTE_DB=1` p/ DB gerenciado (`account-cli.ts:22-23,65`); sem isso o staging sobe mas ninguém loga |
| 35 | deploy/nginx/default.conf:12 | "placeholder favicon" | LEGITIMATE | |

## Contagem por classe
TEST_ONLY 1 · DEV_ONLY 14 · DOC 4 · LEGITIMATE 15 · STAGING_BLOCKER 1 (documental) · PRODUCTION_BLOCKER 0. Total 35.
(DEV_ONLY: 1,2,6,10,11,12,13,19,20,22,25,26,29,30. DOC: 24,28,31,33. LEGITIMATE: 3,4,5,7,8,9,14,15,16,17,18,21,23,32,35.)

## Avisos (não P0)
- A1 (#34): documentar no runbook o bootstrap do 1º admin (account-cli, `ALLOW_REMOTE_DB=1`, senha via stdin) e proibir `SF_ALLOW_DEMO_ACCOUNTS` em `api.env`.
- A2 (#9): `ALLOW_FAKE_GATEWAY:-1` e `SANKHYA_MODE:-fake` como default de compose tornam o opt-in do F7 implícito; sugerir `:?` obrigatório (decisão do dono; staging com fake é permitido por SNK-3).
- A3 (#33): atualizar comentários/exemplo (`API_AUTH_MODE=local`, `WEB_AUTH_MODE=local`).
- Sem testes que provem em conjunto o boot do compose staging (config-only; nada foi iniciado).

## Linha final
Bloqueadores P0 de código restantes (bloqueia boot seguro de staging com login só-admin, ou vaza dado/credencial fake em produção): **0**.
Itens não-código a fechar antes do primeiro start: #34 (runbook do 1º admin, STAGING_BLOCKER documental), #33 e #9 (avisos).
