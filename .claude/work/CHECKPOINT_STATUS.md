# Checkpoint parcial (sessão interrompida pelo dono)

Commits locais (sem push): 3864939 compose seed overlay · a9a2243 plano migration 0006 · 7509dde backend (escopo, customer_ineligible, loginExternal fail-closed) · 9b83b80 web paridade · 0222152 mobile · 2b887ac nginx WEB_AUTH_MODE · df9cd23 web review fix.

Testes verificados por mim: server 664/664, domain 279, contracts 107, sankhya 156, mobile jest 379, mobile-db 134, openapi:check atual, lint limpo, tsc web/mobile limpo.
Web: 401/401 isolado e ocioso; um rerun sob carga de agentes paralelos falhou 7 testes (timeout ~1.2s) -> FLAKE_UNCONFIRMED, refazer com a máquina ociosa.
Mobile products-screen: FLAKE_UNCONFIRMED (1 falha em 35 execuções).

Revisões finais: security-reviewer 0 CRITICAL/HIGH, 2 MEDIUM (login externo revela credencial válida; lockout de usuário ERP no verificador) -> correção em andamento/documentada; code-reviewer sem bloqueadores (MEDIUM mobile em correção).

Pendente: commit das correções em andamento (backend MEDIUM-1/LOW-1/LOW-3; mobile cascata/customer_without_seller), matriz funcional final, rerun completo web ocioso.
Bloqueios: EXTERNO = credenciais Sankhya, mecanismo real de auth, fonte real de fotos. CÓDIGO = não existe AUTH_MODE não-dev (PB-1), sem compose/eas de staging (SB-1/SB-2). HUMANO = ver VERIFIER_DESIGN.md e STAGING_READINESS_PLAN.md.
INFRA_READY_FOR_STAGING=NO · READY_FOR_STAGING=NO · READY_FOR_PRODUCTION=NO · PHOTOS_SOURCE_VALIDATED=BLOCKED

## Atualização final
Commits adicionais: df9cd23 web review fix · bc86cce mobile cascata/customer_without_seller · c0fd14d server (login externo uniforme, 403 resistente a falha de auditoria, produção recusa contas demo; variável SF_ALLOW_DEMO_ACCOUNTS ainda não documentada em .env.example/docs).
Verificado por mim: server 670 (reportado pelo agente, 664 antes), mobile jest 379, mobile-db 137, web 403/403 ocioso (a falha sob carga fica FLAKE_UNCONFIRMED).
Pendente: matriz funcional final (PREPROD_FUNCTIONAL_MATRIX.md rascunho), reexecução completa do server, nova passada do security-reviewer nas correções, documentar SF_ALLOW_DEMO_ACCOUNTS, PB-1/SB-1/SB-2.

---
# CHECKPOINT FINAL — 2026-10-01 17:10
Branch: feat/sales-force-evolution · HEAD: 613954a (local, NÃO enviado; sem push/merge)
Commits locais da rodada: 3864939 compose seed overlay · a9a2243 plano migration 0006 · 7509dde backend · 9b83b80 web · 0222152 mobile · 2b887ac nginx WEB_AUTH_MODE · df9cd23 web review fix · bc86cce mobile cascata · c0fd14d server fixes · 613954a notas de trabalho.
git status: apenas untracked antigos (.claude/references/, .claude/work/{CURRENT,HANDOFF_2026-09-29,M5_SALES_DATA_MAP,MIRROR_AND_CLEANUP_PLAN,MOBILE_SALES_FORCE_PARITY,VIDYA_PARITY_MATRIX}.md, REAL_CONFIG_*.json, auth-spike/, work/) — não revisados, não commitados de propósito. Nenhum tracked pendente.
Agents/processos: nenhum agent rodando; Docker Desktop apenas (stack dev não alterada).

Concluído: compose seed overlay; escopo vendedor/all_visible/NO_SELLER_SCOPE; customer_ineligible (server+web+mobile); loginExternal fail-closed uniforme; recusa de contas demo em produção; WEB_AUTH_MODE obrigatório; mobile logout só retry, cleartext fail-closed, cache de imagem por dono; web duplicar/perfil/recarregar/status; plano migration 0006.
Parcial: matriz funcional (só rascunho); paridade mobile templates/repeat-last = P1; cascata mobile corrigida mas sem teste em dispositivo.
Testes que passaram (rodados nesta sessão): server 664 (agente: 670 após últimas correções), domain 279, contracts 107, sankhya 156, mobile jest 379, mobile-db 137, web 403 (ocioso), openapi:check atual, lint limpo, tsc web/mobile limpo. db 49 (agente).
PENDENTE rodar: server completo após c0fd14d (eu não rerodei), typecheck/build de server, db, Playwright/vite build, M55.
Flakes: web sob carga (7 falhas, FLAKE_UNCONFIRMED); mobile products-screen (1/35, FLAKE_UNCONFIRMED).
Reviews concluídos: security-reviewer (0 CRIT/HIGH; MEDIUM-1 corrigido, MEDIUM-2 documentado em VERIFIER_DESIGN.md); code-reviewer (sem bloqueadores). PENDENTES: nova passada de segurança sobre c0fd14d/bc86cce; mobile ignora `review` do servidor; elegibilidade duplicada em 4 pontos.
BLOCKER-SNK-CREDENTIALS: BLOCKED_EXTERNAL_SECRET (não contornar, não pedir ao usuário).
AUTH: BLOCKED (não existe AUTH_MODE != dev; loginExternal sem rota/adaptador) · PHOTOS_SOURCE_VALIDATED: BLOCKED · staging: INFRA=NO, AUTH=NO, sem compose staging nem eas.json · migration 0006: NOT VALID, plano A-D em docs/migration-0006-plan.md, VALIDATE não executado · mobile/web/backend: ver "Concluído".
INFRA_READY_FOR_STAGING=NO · READY_FOR_STAGING=NO · READY_FOR_PRODUCTION=NO.
Documentar ainda: SF_ALLOW_DEMO_ACCOUNTS (lido de process.env; falta em .env.example/docs).

## RESUME HERE
1. Ler este arquivo; `git status` e `git log -12 --oneline` (esperado HEAD 613954a).
2. Rodar `pnpm --filter` do server completo (Docker Desktop ligado) e `apps/web` isolado (`pnpm exec vitest run`), registrar PASS/FAIL.
3. Documentar SF_ALLOW_DEMO_ACCOUNTS em deploy/.env.example e docs; commit local.
4. Finalizar .claude/work/PREPROD_FUNCTIONAL_MATRIX.md (cada linha: backend, web, mobile, offline, status, evidência, bloqueio, ação).
5. Rodar security-reviewer só sobre c0fd14d e bc86cce.
6. Decidir com o dono: PB-1 (modo de auth não-dev), compose staging (SB-1), eas.json/package id (SB-2), emenda STACK-2 (VERIFIER_DESIGN.md), R35/R36.
7. Proibido: push, merge, produção, escrita no Sankhya, abrir .env, pedir credenciais, pm clear/uninstall no M55.
