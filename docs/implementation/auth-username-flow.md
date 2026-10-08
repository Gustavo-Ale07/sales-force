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
- `VERIFIED_AUTO_PROVISION`: liga-se só por `EXTERNAL_AUTO_PROVISION=1` (padrão `0`; exige `EXTERNAL_LOGIN_ENABLED=1`, validado na partida) ou por configuração explícita de teste. `EXTERNAL_DIRECTORY_MAX_AGE_MINUTES` (padrão 120, 5–1440) é a idade máxima aceita do espelho da relação usuário→vendedor. `withExternalSellerLogin` (testes) usa `PRE_LINKED` por padrão.

## Contas externas não têm senha local

Conta com `external_user_id` preenchido nunca recebe nem usa senha local:

- `AccountService.setPassword` recusa com `ExternalAccountPasswordError` (mensagem acionável: trocar a senha no ERP); o CLI `account set-password` mostra a mesma mensagem. A guarda também está na própria instrução `UPDATE` (`AccountRepository.updatePasswordHash` filtra `external_user_id IS NULL` e devolve `false`), então um vínculo feito em paralelo não é atropelado. `createAccount` nunca grava `external_user_id`; o provisionamento grava só o marcador inutilizável.
- `AuthService.login` não verifica o hash local dessas contas (faz a verificação fictícia de mesmo custo) e as trata como nome desconhecido: com o login externo ligado vão ao diretório; desligado, recusa uniforme (auditoria: `external_account_local_login`). Nunca chegam a `success` por hash de senha. Admin/técnico locais seguem normais.
- Hash malformado (inclui o marcador `!external-directory-account`) custa a mesma verificação Argon2id que um nome desconhecido (sem sinal de tempo).

## Piso de latência de falha

Com `externalLogin.enabled`, toda falha de credencial responde em no mínimo `minFailureMs`, contado desde o início da tentativa: senha local errada, conta local desativada/papel recusado, nome desconhecido (local + diretório, um único piso) e credencial inválida no diretório. Sucesso e respostas 429/503 não são preenchidos. Com o login externo desligado nada muda. Implementação: `failure-floor.ts` (`padFailure`; relógio e sleep substituíveis nos testes).

## Provisionamento e revogação (só `VERIFIED_AUTO_PROVISION`)

**Fonte da relação.** A API não fala com o Sankhya (STACK-2a): o worker espelha `TSIUSU.CODUSU → CODVEND` em `erp_directory_user` (somente os dois códigos, sem PII; entidade `directoryUsers`, cron `SYNC_CRON_SELLERS` ou, com o espelho geral desligado, `AUTH_DIRECTORY_SYNC_ENABLED=1` + `AUTH_DIRECTORY_SYNC_CRON` (padrão `*/15 * * * *`, só `sellers` + `directoryUsers`, mais sincronização inicial na partida do worker), frescor em `sync_state`). A identidade vem do login humano (verifier) e é só o `externalUserId` estável; a relação vem do espelho. Nunca por nome, e-mail ou coincidência de códigos. **O `idusu` decodificado ser igual a `CODUSU` ainda precisa de validação** (sonda somente leitura no SANDBOX: `.claude/work/sankhya-user-probe.mjs`); até lá `EXTERNAL_AUTO_PROVISION` fica `0` em staging.

**Decisão (`decideDirectorySeller`, domínio, pura).** Recusas na ordem: `directory_stale` (espelho nunca sincronizado ou mais velho que o máximo) · `user_missing` · `no_seller` · `seller_inactive` (inexistente, inativo ou removido no espelho) · `seller_ambiguous` (outro usuário ERP aponta o mesmo vendedor) · `seller_claimed` (outra conta Force já vinculada ao vendedor); mais `invalid_identity`, `no_configuration`, `conflict`. Ao cliente: sempre `Usuário ou senha inválidos.`; o motivo só vai à auditoria (`auth.login.failure` com `external_directory_refused` + `auth.directory.link_refused`).

**Criação / reconciliação** (`DrizzleExternalAccountLinks.syncFromDirectory`, uma transação: trava consultiva por vendedor → conta `FOR UPDATE` → decisão): primeiro login cria conta `seller` (senha local inutilizável, nome = nome do vendedor no ERP) + vínculo `source='sankhya_auto'` + auditoria; logins seguintes reutilizam; logins simultâneos do mesmo usuário → uma conta e um vínculo; dois usuários no mesmo vendedor → ambos recusados (ambíguo), nada roubado. Contas de outros papéis (admin/manager/technical) e vínculos `manual` (PRE_LINKED/`create-external`) nunca são tocados.

**Revogação.** O vínculo automático segue o ERP: reavaliado em todo login e, em sessão ativa, no `resolveSession` no máximo a cada `sessionTouchIntervalMs` (60 s). Recusa definitiva (usuário sumiu, sem vendedor, vendedor inativo/ambíguo/reivindicado) remove o vínculo automático, revoga as sessões e audita `auth.directory.link_revoked`. Troca de vendedor no ERP (`relinked`) revoga as sessões: novo login com o novo escopo. Espelho velho/indisponível → nega (falha fechada) sem alterar nada. **Janela total de revogação ≈ intervalo do cron do espelho + 60 s.** Conta desativada segue o fluxo normal de status.


**Autenticação × autorização.** Credencial Sankhya errada → 401 `invalid_credentials` ("Usuário ou senha inválidos."). Login Sankhya válido sem acesso Force provado (diretório obsoleto, sem vendedor, vendedor inativo/ambíguo/reivindicado, papel/canal recusado) → 403 `access_not_configured` ("Usuário autenticado, mas o acesso ao Force ainda não está configurado."), sem sessão; a auditoria guarda o motivo técnico real em `detail.technical`.

**Contas existentes que não são vendedor.** Conta externa já existente com papel gerente/admin/técnica não passa pela sincronização de vendedor: não exige `CODVEND`, não é convertida e não gera `external_directory_refused` (SUP segue gerente). Vínculo `manual` nunca é substituído, convertido ou revogado pelo espelho; só vínculos `sankhya_auto` são reavaliados (login e `resolveSession`). `authMode` é o modo de instalação (`dev|local`), não a origem do login.

**Limites conhecidos (revisão de segurança, 2026-10-07).** (1) `EXTERNAL_AUTO_PROVISION=1` exige também `EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1` (a equivalência `idusu` = `CODUSU` só vale depois da sonda; sem isso a partida falha). (2) Bloqueio/inativação do usuário no Sankhya só é detectado se a linha sumir ou o vendedor mudar (coluna de ativo de `TSIUSU` NEEDS VALIDATION); até lá o controle durável é `account.status`. (3) Vínculo removido por operador é reatribuído num novo login a partir do ERP (a reavaliação de sessão nunca insere); para cortar acesso de forma durável, desative a conta. (4) O espelho cobre todos os usuários: quem compartilha `CODVEND` com um vendedor (ex.: gerente) torna ambos `seller_ambiguous` (falha fechada). (5) Espelho velho (> `EXTERNAL_DIRECTORY_MAX_AGE_MINUTES`) nega as sessões de vendedores automáticos (falha fechada; sem linha de auditoria por requisição). (6) `upsertSellerLink` (configuração/administração) e `create-external` gravam vínculo `manual` e usam a mesma trava consultiva por vendedor.

## Escopo de vendedor e pré-vínculo (`PRE_LINKED`)

O login prova apenas a identidade (`externalUserId`). O escopo de vendedor vem exclusivamente de `account` + `account_seller_link` + `erp_seller`: papel `seller` exige ao menos um vínculo, e todo vendedor vinculado deve existir, estar ativo e não removido no espelho; caso contrário, `invalid_credentials` (auditoria `no_link` / `external_seller_inactive`). `sellerCode: null` do verificador (o caso real) **não** é divergência; um `sellerCode` válido informado no futuro serve só como validação extra (divergência → `mismatch`). Admin/manager/technical não exigem vínculo. Nunca há vínculo automático nem por nome/login.

**Portões de papel (2026-10-07).** Senha local: só `admin`/`technical` (e `seller` quando o login externo está ligado) — um `manager` local com senha continua recusado (`mode_role_not_permitted`). Sessão: `manager` pode manter sessão **somente** quando a conta tem `external_user_id` (papel “somente externo”, `AuthConfig.externalOnlyRoles`, definido só por `withExternalSellerLogin`); o login externo, `resolveSession` e `peekSession` aplicam o mesmo portão. Nenhuma permissão comercial do manager mudou (a política central continua decidindo).

### `account create-external` (operador)

`pnpm --filter @salesforce/server account create-external --email <login> --name "<nome>" --role <papel> [--seller-code <n>] [--password-stdin]`

A senha Sankhya é lida do terminal sem eco (ou da primeira linha do stdin com `--password-stdin`), nunca de argumento, e validada pelo verificador interno (`VERIFIER_URL` + `VERIFIER_SHARED_SECRET[_FILE]`; a CLI não fala com o Sankhya). O `externalUserId` vem dessa autenticação real, nunca é digitado nem impresso. Cria somente (login existente, inclusive o admin local, é recusado): conta ativa com senha local inutilizável, `external_user_id`, vínculo explícito para `seller` (vendedor ativo, sem vínculo, versão de configuração corrente), auditoria `account.created`/`account.seller_linked` na mesma transação. Saída única: `external account created/linked successfully`.

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

## Login com a senha Sankhya — mecanismo do verifier `live` (2026-10-07, SANDBOX apenas)

Browser → API → verifier interno → Sankhya **Sandbox** (`*-teste.sankhyacloud.com.br`; o verifier recusa qualquer outro host, SNK-3). Depois da validação a API cria a própria `sf_session`; a sessão Sankhya nunca sai do verifier e nunca vai ao browser. Código: `apps/server/src/verifier/sankhya-login.ts`.

**Provado no Sandbox (sonda do dono, 2026-10-07):** `MobileLoginSP.login` com usuário válido → HTTP 200, `status=1`, `responseBody` com chaves `callID, jsessionid, idusu`; logout `status=1`. Senha errada → HTTP 200, `status=0`, `CORE_E01434`. Qualquer outro serviço com a sessão do usuário (`CRUDServiceProvider.loadRecords`, `SessionManagerSP.getAttribute`) exige Bearer Token → **não há segunda consulta**.

| # | Ponto | Resultado | Status |
|---|---|---|---|
| 1-3 | Endpoint / serviço / método | `POST {origin}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json` | PROVADO |
| 4-5 | Payload / headers | JSON `{serviceName, requestBody:{NOMUSU:{$},INTERNO:{$},KEEPCONNECTED:{$:'N'}}}`, `content-type: application/json`; sem token técnico | PROVADO |
| 6 | Cookie/sessão | `responseBody.jsessionid`; só usado no logout, em memória | PROVADO |
| 7-8 | Identificação / id estável | `responseBody.idusu` (`{$: string}`), na MESMA resposta que autenticou a senha. É o **Base64 padrão do código decimal do usuário**, às vezes com whitespace de transporte (ex.: `"MA==
"`). `decodeSankhyaUserId`: remove só espaço/TAB/CR/LF → Base64 estrito (alfabeto, padding, decode, re-encode e comparação) → texto `^[0-9]{1,18}$` → `externalUserId` EXATAMENTE esse texto (0 válido, sem `Number`/`parseInt`, sem tirar zeros, sem supor sequência). Estável entre dois logins (provado no TESTE com SUP, 2026-10-07). Que o código seja `TSIUSU.CODUSU` não está documentado | PROVADO (formato e estabilidade); semântica NEEDS VALIDATION |
| 9 | Senha humana | só no corpo do login, em memória; nunca logada, auditada, cacheada ou devolvida | implementado e testado |
| 10 | Credencial técnica | **não necessária** | PROVADO |
| 11 | Inválida × indisponível | `status 0` + `CORE_E01434` = recusada (403 → "Usuário ou senha inválidos."); rede, timeout, HTTP ≠ 200, não-JSON, código desconhecido, sem `jsessionid` ou `idusu` válido = indisponível (503, fail closed) | implementado e testado |
| 12 | Usuário desativado | código específico **desconhecido** → cai em indisponível até ser observado | NEEDS VALIDATION |
| 13 | Encerrar sessão Sankhya | `MobileLoginSP.logout` sempre (best effort) | PROVADO + testado |

Contrato do verifier: `{ ok:true, externalUserId, username, active:true, verifiedAt }`. O vendedor (CODVEND) **não** é resolvido no login: vem do vínculo da conta (PRE_LINKED), nunca por nome nem pelo login.

Prova com credencial real (só estrutura, sem valores; dois logins para checar a estabilidade de `idusu`): `! node .claude/work/auth-spike/sankhya-login-probe.mjs`.

Ligar no staging (somente após CI verde e autorização do dono): mesmo `VERIFIER_SHARED_SECRET` em `api.env` e `verifier.env`; em `compose.env`: `EXTERNAL_LOGIN_ENABLED=1`, `VERIFIER_MODE=live`, `VERIFIER_SANKHYA_BASE_URL=https://<conta>-teste.sankhyacloud.com.br`, `VERIFIER_EGRESS_NETWORK=verifier_egress`.

Riscos residuais (revisão de segurança):
- **Egress sem filtro de rede (médio/baixo):** `verifier_egress` é saída aberta; só o allow-list de aplicação restringe o destino. Aceito para o Sandbox; exigir proxy/firewall restrito antes de qualquer uso além dele.
- **Usuário bloqueado (baixo):** código desconhecido responde 503 (distinguível de senha errada); mapear para a negativa uniforme quando o código for observado.
