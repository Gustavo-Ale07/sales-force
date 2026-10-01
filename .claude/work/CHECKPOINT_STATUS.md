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
