# CHECKPOINT 2026-10-07 — login automático de vendedores (fim do dia)

Nota de continuidade, sem autoridade de decisão (a autoridade é `docs/decisions.md`). Não commitar/push só esta nota.
Repo `sales-force-evolution` · branch `feat/sales-force-evolution` · HEAD local = origin = `7d7999b93460508e8e0264bdb38de27088326b24` · site https://force.sistemasplac.com.br · árvore limpa antes desta nota.

## Objetivo
Concluir o login automático dos vendedores: credenciais humanas → verificador interno → Sankhya TESTE → identidade estável (idusu) → vínculo oficial `TSIUSU.CODUSU→CODVEND` (mirror `directoryUsers`) → conta Force só-`seller` + escopo → sessão própria. Sem cadastro manual duplicado (ex.: GUSTAVO SOUSA: usuário 7, vendedor 76 — só evidência, nunca hardcode).

## Estado confirmado
- SUP entra como manager externo. `8cfb3b1`: manager externo ok; manager local continua bloqueado por senha.
- `7d7999b` (implementado, testado, revisado): mirror `directoryUsers` (migration 0011, tabela `erp_directory_user`, cron `SYNC_CRON_SELLERS`, frescor em `sync_state.lastSuccessAt`), `decideDirectorySeller` (domínio), provisionamento automático seller-only, reconciliação/revogação (`auth.directory.link_refused|revoked`), vínculos `source` manual|sankhya_auto. Auto-provisionamento ENTREGUE DESLIGADO.
- Deploy: CI passou; deploy automático falhou no migration pre-check (precisa `db-roles`; o script lê `SF_RUN_DB_ROLES` só do ambiente e o wrapper SSH usa `env -i`, então só passa em execução manual). O dono rodou na VPS como `force-deploy`: `SF_RUN_DB_ROLES=1 .../deploy-staging.sh 7d7999b9...` → backup ok, migration 0011 aplicada, fila `sync.mirror.directoryUsers` criada, ops-db-roles OK, api/worker/verifier/web saudáveis, `/api/v1/ready` 200, DEPLOY OK, `--print-deployed-sha` = `7d7999b...`. **Não repetir o deploy sem necessidade nova.**
- GUSTAVO SOUSA foi recusado; causa NÃO comprovada (hipótese: `external_unmapped` — sem conta Force para o `external_user_id`, auto-provisionamento desligado).
- Tela do Sankhya mostra usuário 7 ↔ vendedor 76: NÃO prova que o idusu devolvido pelo login humano == CODUSU.

## Próximas etapas (ordem)
1. Confirmar estado do servidor e que o mirror `directoryUsers` foi populado por leitura real do TESTE, com atualização recente (`.claude/work/staging-login-diagnosis.sql` seção 6; logs do worker). Dono roda SQL/logs na VPS e cola só o resultado.
2. Auditoria: seções 1–3 do mesmo SQL → provar a causa da recusa de GUSTAVO SOUSA.
3. Validar idusu(login humano) ↔ CODUSU, incl. 7 → 76: dono roda no terminal local `! node .claude/work/sankhya-user-probe.mjs 7` (prompt oculto, SANDBOX, somente leitura).
4. Revisar o que cada sonda prova: consulta técnica a TSIUSU não prova a identidade devolvida pelo login humano; só a seção da sonda que usa o login real (e/ou o idusu decodificado no verificador) prova. Registrar fatos × hipóteses em `docs/sankhya-spike.md`.
5. Campos oficiais de atividade/bloqueio de TSIUSU: verificar; se não validados, documentar a limitação e o efeito em sessões existentes (revogação ≈ intervalo do cron do mirror + 60 s; usuário bloqueado no ERP só é pego se o campo for conhecido).
6. Só após as provas: `EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1` e `EXTERNAL_AUTO_PROVISION=1` (com `EXTERNAL_LOGIN_ENABLED=1`) pelo mecanismo do compose (`compose.env` na VPS; vars já mapeadas em `deploy/docker-compose.staging.yml`; exige reinício/redeploy do api — descobrir o caminho mínimo, sem recriar postgres).
7. Validar login real do GUSTAVO (navegador, pelo dono): conta única, carteira só do vendedor 76, refresh, logout, novo login. Preservar SUP e admin local.
8. Relatório: provado × pendente.

## Acesso e segredos
- Minha chave de deploy só executa `deploy <sha>` e `print-deployed-sha`; sem acesso à VPS, ao banco ou ao `db-admin.env`. Fazer direto o que der; quando precisar do dono, entregar só o próximo comando, dizendo **VPS** ou **terminal local**.
- Nunca exibir arquivos de segredos nem pedir senha no chat (prompt oculto ou navegador). Não recriar SUP, não alterar senhas, não contornar identidade/permissões. Sem merge em main, sem outro ambiente, sem escritas no Sankhya.
- Regras de domínio: nunca presumir idusu==CODUSU sem validação; sem match por nome/e-mail; vendedor-only; sem senha local em conta externa; falha fechada em mirror velho; mensagem uniforme de credenciais inválidas.

## Utilitários
`.claude/work/sankhya-user-probe.mjs` (NÃO executada ainda) · `.claude/work/staging-login-diagnosis.sql` · `docs/implementation/auth-username-flow.md` · `deploy/README-cicd.md` (§Database objects needing db-roles, passo 7) · melhoria opcional não feita: pre-check do deploy falhar cedo se `db-admin.env` ilegível.

## Próxima fase (NÃO iniciar): envio de pedidos ao Sankhya TESTE
Usuário monta o pedido completo no Force; Sankhya gera NUNOTA; Force armazena (sem preenchimento manual). Preservar: SNK-4 (sem escrita duplicada, campo de origem verificado antes de retry), SNK-5 (campo de origem dedicado), SNK-6 (envio ERP desligado até fechar gates), V-11/V-13, escrita só via `integration_outbox` + worker (pg-boss como execução), validação de cabeçalho/itens, idempotência; sem segundo write no Sandbox sem autorização do dono.

## Operações em andamento
Nenhuma: sem processos em segundo plano, sem deploy/commit/push pendentes. Falta apenas esta nota (não commitada).
