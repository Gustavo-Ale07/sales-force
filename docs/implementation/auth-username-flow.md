# Login por usuário — estratégia híbrida temporária

Status: IMPLEMENTADO NO CÓDIGO, **não publicado**. Login externo (Sankhya) **DESLIGADO por padrão**. Mecanismo oficial de autenticação humana do Sankhya: **não definido** — "Falta definir o mecanismo oficial de autenticação humana do Sankhya." Nada aqui é decisão aprovada em `decisions.md`.

## Contrato

`POST /api/v1/auth/login` recebe `{ username, password }` (antes `{ email, password }`).

- `username`: só `trim()`; mantém maiúsculas/minúsculas e qualquer `@`; não exige domínio (`normalizeUsername`, `packages/domain`). Aceita `gustavo`, `SAMUEL`, `usuario.teste`.
- Erro de credencial: "Usuário ou senha inválidos." (`invalid_credentials`, uniforme). Indisponibilidade: "Não foi possível realizar a autenticação no momento. Tente novamente." (`service_unavailable`).
- O campo do DTO `Account` agora é `username` (antes `email`; sem `z.email()`). A coluna física continua `account.email` (ver "Dívida de nomenclatura"); em contas provisionadas vale `sankhya:<externalUserId>`. Não é endereço de e-mail.

## Fluxo

1. `AuthService.login` procura a conta local pelo login (comparação sem diferenciar caixa, só para casar a conta local e para a chave de throttle).
2. Conta local existe → o veredito é final: senha errada, conta desativada ou papel não permitido **nunca** consulta o Sankhya. O admin local segue funcionando (transição documentada, sem fallback inseguro).
3. Só se a conta local **não existe** (ou o papel não é permitido no modo) **e** `externalLogin.enabled === true` **e** verificador/links estão ligados → `loginExternal`.
4. `loginExternal`: `IdentityVerifier` (`SankhyaIdentityVerifier`) → verificador interno (`POST /internal/verify`, Bearer secret) → adaptador humano do Sankhya (**inexistente**; o verificador hoje só nega). Falha fechada: qualquer coisa diferente de identidade válida é recusa uniforme/indisponível. O login é enviado ao verificador exatamente como digitado (trim).
5. Identidade válida → conta por `account.external_user_id` (ID estável do usuário Sankhya). Não existe → em `PRE_LINKED` (padrão) recusa; só em `VERIFIED_AUTO_PROVISION` há provisionamento restrito (abaixo). Sessão própria do Force (cookie opaco `sf_session`, hash SHA-256 no banco, sem JWT).

## Modo de vínculo (`linkMode`) — padrão `PRE_LINKED`

`ExternalLoginConfig.linkMode`: `PRE_LINKED` (padrão, também quando omitido) ou `VERIFIED_AUTO_PROVISION`.

- `PRE_LINKED`: só entra quem já tem conta com `account.external_user_id` igual ao ID do diretório (vínculo feito por administrador). Usuário do diretório sem conta vinculada é recusado (`external_unmapped`, erro uniforme); `provisionSeller` nunca é chamado; nenhuma conta nem vínculo é criado.
- `VERIFIED_AUTO_PROVISION`: mantém o provisionamento restrito abaixo, mas só por configuração explícita. `authConfigFromEnv` não expõe nem habilita nenhum dos modos (nenhuma variável de ambiente liga o login externo ou o auto-provisionamento). `withExternalSellerLogin` (testes) usa `PRE_LINKED` por padrão.

## Contas externas não têm senha local

Conta com `external_user_id` preenchido nunca recebe nem usa senha local:

- `AccountService.setPassword` recusa com `ExternalAccountPasswordError` (mensagem acionável: trocar a senha no ERP); o CLI `account set-password` mostra a mesma mensagem. A guarda também está na própria instrução `UPDATE` (`AccountRepository.updatePasswordHash` filtra `external_user_id IS NULL` e devolve `false`), então um vínculo feito em paralelo não é atropelado. `createAccount` nunca grava `external_user_id`; o provisionamento grava só o marcador inutilizável.
- `AuthService.login` não verifica o hash local dessas contas (faz a verificação fictícia de mesmo custo) e as trata como nome desconhecido: com o login externo ligado vão ao diretório; desligado, recusa uniforme (auditoria: `external_account_local_login`). Nunca chegam a `success` por hash de senha. Admin/técnico locais seguem normais.
- Hash malformado (inclui o marcador `!external-directory-account`) custa a mesma verificação Argon2id que um nome desconhecido (sem sinal de tempo).

## Piso de latência de falha

Com `externalLogin.enabled`, toda falha de credencial responde em no mínimo `minFailureMs`, contado desde o início da tentativa: senha local errada, conta local desativada/papel recusado, nome desconhecido (local + diretório, um único piso) e credencial inválida no diretório. Sucesso e respostas 429/503 não são preenchidos. Com o login externo desligado nada muda. Implementação: `failure-floor.ts` (`padFailure`; relógio e sleep substituíveis nos testes).

## Provisionamento (restrito, só `VERIFIED_AUTO_PROVISION`)

Só cria conta `seller`, em uma transação com vínculo e auditoria (`account.created`), quando: identidade verificada e ativa; `externalUserId` estável e não vazio; `sellerCode` válido vindo do verificador; vendedor existe em `erp_seller`, `active` e sem `deleted_at`; vendedor ainda sem vínculo a outra conta. Nunca cria admin/technical/manager; nunca vincula por nome ou usuário aproximado; senha local inutilizável (`!external-directory-account`); a senha Sankhya nunca é gravada. Concorrência: trava de linha em `erp_seller` + `ON CONFLICT` em `external_user_id` (mesmo usuário em paralelo → uma conta; dois usuários, mesmo vendedor → um vence).

Em logins seguintes: vendedor inativo/removido no espelho → recusa (`external_seller_inactive`); vendedor do diretório diferente do vinculado → `external_link_mismatch`; conta desativada → recusa. Dados do verificador nunca mudam o papel de conta existente.

## Dívida de nomenclatura (coluna física `account.email`)

A coluna continua `account.email` (índice único em `lower(email)`) e guarda o identificador de login, não um e-mail. Para evitar uma refatoração de banco arriscada agora, o mapeamento ocorre só em `AccountRepository` (`AccountRecord.username`, `findByUsername`) e em `SessionRepository`; serviços, `CurrentUser`, DTOs e clientes usam `username`. Permanecem por compatibilidade de formato persistido: prefixo `email:` da chave de throttle (`loginNameThrottleKey`) e a chave de auditoria `emailFingerprint`; o rótulo do CLI `--email`; `ScopeActor.accountEmail` (domínio) e `demo-accounts-check` (e-mails reais de demonstração). Renomear a coluna é trabalho futuro em expand → migrate → contract (nova coluna `username` + índice `lower(username)`, dupla escrita, migração dos dados, leitura da nova, remoção da antiga), com migration testada em Testcontainers e decisão do dono.

## Migration 0008

`account.external_user_id text NULL` + índice único parcial `account_external_user_id_uq` (`WHERE external_user_id IS NOT NULL`). Expand-only; contas antigas ficam NULL. Rollback manual: `DROP INDEX account_external_user_id_uq; ALTER TABLE account DROP COLUMN external_user_id;` (só antes de haver contas externas). Testada em Testcontainers: banco vazio e upgrade 0007→0008 com admin, vendedores e sessões preservados (`apps/server/test/integration/migration-0008.test.ts`).

## Pontos para o dono (não registrados em `decisions.md`)

- `withExternalSellerLogin` (usado só em testes) amplia o modo `local` com o papel `seller` — estende AUTH-5/STACK-2a. Exige decisão antes de qualquer habilitação real.
- "O login verificado no Sankhya é exigido para vendedores?" segue aberto (`VERIFIER_DESIGN.md`).
- Vendedor local sem vínculo (conta com senha local, sem `external_user_id`) continua entrando com a senha local mesmo com o login externo ligado, se o papel for permitido no modo. Exigir o diretório para todo vendedor é decisão do dono (mesma pergunta acima).
- Não existe ferramenta para preencher `account.external_user_id` (vínculo `PRE_LINKED`): hoje só por SQL manual/testes. Um comando administrativo auditado (que também reponha o hash para o marcador inutilizável) é trabalho futuro; sem ele o login externo falha fechado para todos, o que é o estado desejado enquanto estiver desligado.
- Renomear `email` para `username` em `POST /auth/login` e no DTO `Account` não tem janela de compatibilidade (`strictObject`): um build mobile instalado que envie `{email}` recebe 400. Aceitável só se não houver build em campo; decisão do dono (P-16).
- A latência de falha só esconde diferença de tempo até `minFailureMs`; com o login externo ligado, `minFailureMs` deve ser configurado acima do tempo máximo do verificador mais o Argon2.
- O nome da instalação vem de `INSTALLATION_NAME`; o `manifest.webmanifest` é estático e não o acompanha (nome fixo "Force PLAC" na instalação PLAC).
- Para habilitar de verdade faltam: mecanismo humano do Sankhya comprovado em ambiente não produtivo, adaptador no verificador (`VERIFIER_MODE=live` hoje é recusado no boot), configuração de produção, revisão de segurança.

## Testes

`apps/server/test/integration/auth-username-hybrid.test.ts` (provisionamento sob `VERIFIED_AUTO_PROVISION`, `PRE_LINKED`, senha local de conta externa, piso de latência), `migration-0008.test.ts` (2), `packages/domain/test/normalize-username.test.ts`, contratos, web e mobile.
