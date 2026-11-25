# Runbook: abrir a escrita de cliente no Sandbox e rodar T1–T9 (criação e edição)

Status: **NÃO EXECUTADO.** Depende de deploy do código deste lote no staging. Autorização do dono (2026-11-25): a porta `updatePartner` e o roteiro T1–T9 valem **somente no Sandbox** (`placfestas-teste`); produção nunca é tocada. Quem executa é o dono (ou quem ele indicar), no VPS de staging. O agente de código não contata o Sandbox nem o VPS. Complementa `docs/implementation/partner-write-sandbox-script.md` (itens NEEDS VALIDATION e convenções) e `docs/implementation/snk-7-dry-run.md` §5.1 (mecanismo do arquivo de override).

Regras que não mudam (SNK-3, SNK-4, SNK-6, D-AR): staging nunca fala com a produção; a escrita só abre com `SF_DEPLOY_ENVIRONMENT=staging`, `SANKHYA_MODE=live`, `SANKHYA_ENVIRONMENT=sandbox` e host na lista fixa em código; `LIMCRED` nunca é enviado; só o worker tem a credencial; um envio antes de reler/buscar por origem não existe.

## 1. Antes de ligar

1. O código deste lote está implantado no staging (`deploy-staging.sh`) e a migração `0048_customer_registration_corrects` aplicou (one-shot do deploy). Conferir: `SELECT count(*) FROM information_schema.columns WHERE table_name = 'customer_registration' AND column_name = 'corrects_registration_id';` = 1.
2. O campo de origem do parceiro existe no Sandbox (`TGFPAR.AD_FORCEORIGEM`, mesmo padrão do pedido, SNK-5). Se não existir, a criação para aqui (consulta do T1 falha); criar o campo é ação da TI, fora deste runbook.
3. As credenciais do Sandbox estão no `worker.env` (nunca neste arquivo nem em Git, SEC-1).
4. Anotar o horário de início (UTC) para filtrar as consultas de auditoria.

## 2. Abrir as chaves (mesmo mecanismo do pedido, recria só api e worker)

O arquivo de override vive **só no servidor**, em `/opt/force-staging/config/compose.write-sandbox.yml`, fora do Git. Ele já pode conter o bloco dos pedidos; **acrescentar** (não substituir) as variáveis de cliente:

```
services:
  worker:
    environment:
      SANKHYA_CUSTOMER_WRITE_ENABLED: "true"
      SANKHYA_CUSTOMER_ORIGIN_FIELD: AD_FORCEORIGEM
      # opcional: tabela de preço padrão do cliente novo; sem a variável vale o padrão do ERP
      # SANKHYA_CUSTOMER_PRICE_TABLE: "5"
      SANKHYA_MODE: live
      SANKHYA_ENVIRONMENT: sandbox
      SANKHYA_BASE_URL: <um dos dois hosts do Sandbox, os mesmos do bloco live dos pedidos>
  api:
    environment:
      ERP_CUSTOMER_ENQUEUE_ENABLED: "true"
      ERP_CUSTOMER_EDIT_ENABLED: "true"
```

Se o arquivo já tem `SANKHYA_MODE`, `SANKHYA_ENVIRONMENT` e `SANKHYA_BASE_URL` do bloco live dos pedidos, não repetir: o YAML não pode ter chave duplicada. `SF_DEPLOY_ENVIRONMENT=staging` já vem do compose de staging.

Aplicar (recria só api e worker):

```
deploy/scripts/sf-compose.sh -f /opt/force-staging/config/compose.write-sandbox.yml up -d --no-deps --force-recreate api worker
```

Conferir que subiu e que abriu o que se espera:

```
deploy/scripts/sf-compose.sh logs --since 2m worker | grep -i "escrita de cliente"   # esperado: "escrita de cliente: ligada (Sandbox)"
deploy/scripts/sf-compose.sh logs --since 2m api worker | grep -iE "refus|problem|invalid"   # esperado: vazio
```

- A API só aceita `ERP_CUSTOMER_EDIT_ENABLED=true` junto de `ERP_CUSTOMER_ENQUEUE_ENABLED=true` e só em `SF_DEPLOY_ENVIRONMENT=staging`; o worker só aceita `SANKHYA_CUSTOMER_WRITE_ENABLED=true` com staging + live + sandbox + host da lista. Qualquer violação faz o processo **recusar subir** e o log nomeia a variável (nunca o valor).
- `GET /configuration/order-entry`, campo `general.clientCreationEnabled` e `general.clientEditEnabled`, devem vir `true`/`true` (site e app só mostram criar/editar com isso).
- Atenção: qualquer `deploy-staging.sh`, `rollback-staging.sh` ou `sf-compose.sh` **sem** o `-f` volta a tudo fechado. Para religar, repetir o comando de aplicar.

### Fechar de novo (fim do teste ou qualquer dúvida)

```
deploy/scripts/sf-compose.sh up -d --no-deps --force-recreate api worker
```

(sem o `-f`). Linhas já enfileiradas continuam no outbox e não são entregues enquanto o worker estiver fechado.

## 3. Como acompanhar (consultas de PostgreSQL, somente leitura)

Rodar no banco do staging. Use a rota da aplicação para criar/editar (site ou app, perfil vendedor); nunca insira linha direto.

Fila de entrega do cliente (criação e edição), as mais recentes primeiro:

```sql
SELECT aggregate_type, operation, status, attempt_count, last_step, last_error_class,
       left(last_error_message, 160) AS erro, erp_reference, origin_id, next_attempt_at, updated_at
FROM integration_outbox
WHERE aggregate_type IN ('customer_registration', 'customer_update')
ORDER BY created_at DESC
LIMIT 20;
```

Estado do cadastro (criação) e a ligação de correção:

```sql
SELECT id, status, erp_customer_code, rejection_code, corrects_registration_id, updated_at
FROM customer_registration
ORDER BY created_at DESC
LIMIT 20;
```

Auditoria (só nomes de campo e identificadores, nunca valores):

```sql
SELECT at, action, detail
FROM audit_log
WHERE action LIKE 'customer.%'
ORDER BY at DESC
LIMIT 40;
```

Como ler o estado do outbox: `pending` = aguardando envio; `processing` = o worker está tentando; `confirmed` = Sankhya confirmou e o worker releu; `rejected` = recusa definitiva do Sankhya (o vendedor vê "Precisa de correção" com o motivo); `unknown` com `next_attempt_at` nulo = estacionado para uma pessoa (nunca vira rejeição sozinho). Tentativas esgotadas por falha temporária **nunca** viram `rejected`: o worker segue tentando na cadência mais lenta (15 min), sempre verificando antes de reenviar.

## 4. Passos T1–T9 (criação) e T5 (edição)

Convenções do roteiro original valem: nome `TESTE FORCE - NAO USAR <rótulo>`, no máximo 10 clientes, CNPJ/CPF sintéticos válidos, só SELECT no Sankhya, anotar cada CODPARC em `docs/sankhya-spike.md` (S5), nada é apagado. As consultas de TGFPAR abaixo são no Sankhya (DBExplorer, somente leitura) e as de `integration_outbox` são no PostgreSQL do Force.

Consulta base no Sankhya (substituir `:origem`, `:doc` ou `:codparc`):

```sql
SELECT CODPARC, NOMEPARC, TIPPESSOA, CGC_CPF, CLIENTE, ATIVO, BLOQUEAR,
       CODVEND, CODTAB, LIMCRED, AD_FORCEORIGEM, TELEFONE, EMAIL, OBSERVACOES
FROM TGFPAR
WHERE AD_FORCEORIGEM = :origem   -- ou: CGC_CPF = :doc  /  CODPARC = :codparc
```

A chave de origem de uma criação é `force:<id do cadastro>` (`customer_registration.origin_key`); a de uma edição é `force-edit:<clientRequestId>` (`integration_outbox.origin_id`).

SQL do outbox usado em vários passos (substituir `:origem`):

```sql
SELECT aggregate_type, status, attempt_count, last_error_class, left(last_error_message, 160) AS erro,
       erp_reference, origin_id, updated_at
FROM integration_outbox
WHERE origin_id = :origem;
```

| T | Ação (no site ou app, como vendedor) | Esperado | SELECT no Sankhya (TGFPAR) | SQL no PostgreSQL do Force |
|---|---|---|---|---|
| T1 | Criar PJ de teste com IE e vendedor, CNPJ sintético válido | "Aguardando envio" e logo "Enviado ao Sankhya" com CODPARC real, só após a releitura | Consulta base por `:origem`: 1 linha; ATIVO='S', CLIENTE='S', BLOQUEAR='N', CODVEND do vendedor | Outbox por `:origem`: `status='confirmed'`, `erp_reference` = CODPARC, `attempt_count`=1 |
| T1b | Criar PJ com CNPJ que começa em zero | Gravado e relido com 14 dígitos | `SELECT CGC_CPF FROM TGFPAR WHERE CODPARC = :codparc` | Outbox `confirmed` |
| T1c | Criar PF (CPF sintético, sem IE) | Cadastrado, sem IE | Consulta base | Outbox `confirmed` |
| T2 | Criar outro cliente com o mesmo CNPJ (origem nova) | Recusa antes de escrever; o vendedor vê "Precisa de correção" com texto genérico de duplicidade; sem segundo cadastro | `SELECT COUNT(*) FROM TGFPAR WHERE CGC_CPF = :doc` = 1 | Outbox da segunda origem: `status='rejected'`, `last_error_message` começa com `partner_document_duplicate`; `customer_registration.rejection_code='partner_document_duplicate'` |
| T3 | Repetir o mesmo envio (mesmo `clientRequestId`) | Resposta 200 com o mesmo cadastro; nenhuma escrita nova | `SELECT COUNT(*) FROM TGFPAR WHERE AD_FORCEORIGEM = :origem` = 1 | `SELECT count(*) FROM integration_outbox WHERE origin_id = :origem;` = 1 |
| T4 | Criar com o worker parado (`sf-compose.sh stop worker`), depois religar (`start worker`) | "Aguardando envio" enquanto parado; depois "Enviado ao Sankhya" com CODPARC | Consulta base: 0 linhas antes, 1 depois | Outbox: `pending` com `next_attempt_at` preenchido, depois `confirmed` |
| T5 | Editar telefone, e-mail e observações de um cliente de teste já criado (PATCH) | 202 "Aguardando envio" e depois "Enviado ao Sankhya"; o espelho local mostra os valores novos | `SELECT CODPARC, TELEFONE, EMAIL, OBSERVACOES FROM TGFPAR WHERE CODPARC = :codparc` mostra os valores novos | `SELECT aggregate_type, operation, status, attempt_count, last_step, erp_reference, origin_id FROM integration_outbox WHERE aggregate_type='customer_update' AND origin_id = 'force-edit:' \|\| :clientRequestId;` `status='confirmed'`, `attempt_count`=1. Repetir a MESMA requisição: 200 e nenhuma linha nova. Enviar nova edição enquanto a anterior está aberta: 409 `customer_update_in_progress` |
| T6 | Enviar campo bloqueado (razão social, CNPJ, limite) | 400 `validation_failed` citando o campo, antes de qualquer chamada; nada muda | Consulta base inalterada | Nenhuma linha nova em `integration_outbox` |
| T7 | Vendedor tenta editar cliente de outro vendedor | 404 sem revelar dados | Consulta base inalterada | Nenhuma linha nova em `integration_outbox` |
| T8 | Regras de nascimento do cliente criado | ATIVO='S', CODVEND do vendedor, CODTAB conforme configuração, **LIMCRED nulo**, BLOQUEAR='N', CLIENTE='S'; CODTIPPARC/CODREG/TIPOGERBOLETO em 0/0/'I' | Consulta base e `SELECT CODPARC, CODTIPPARC, CODREG, TIPOGERBOLETO, CLASSIFICMS, IDENTINSCESTAD FROM TGFPAR WHERE AD_FORCEORIGEM = :origem` | `customer_registration`: `status='confirmed'` e `erp_customer_code` igual ao CODPARC |
| T9 | Abrir o novo cliente no app e no site | Mesmo CODPARC e dados nos dois | Consulta base contra a tela | `SELECT code, name, seller_code, phone, email FROM erp_customer WHERE code = :codparc;` (o espelho recebe o cliente na confirmação) |

Passos extras que o lote introduz (rodar uma vez):

- **Recusa definitiva e correção.** Provocar uma recusa do ERP (ex.: IE ausente em PJ pela API de teste ou CNPJ duplicado direto no ERP). Esperado: o cadastro aparece em "Precisa de correção" com o motivo (`GET /customers/registrations`); criar de novo com `correctsRegistrationId` do cadastro recusado devolve 201/202 e a recusa deixa de aparecer na lista. SQL: `SELECT id, status, rejection_code, corrects_registration_id FROM customer_registration ORDER BY created_at DESC LIMIT 5;`.
- **Falha temporária nunca vira recusa.** Com o worker rodando, parar a rede do Sandbox não é permitido; o comportamento é coberto por teste automatizado (tentativas esgotadas seguem em nova tentativa a cada 15 min). Em campo, apenas conferir que nenhum cadastro foi para `rejected` por `timeout`/`unavailable`: `SELECT count(*) FROM integration_outbox WHERE status='rejected' AND last_error_class IN ('exhausted','unavailable','temporary');` = 0.

Casos de falha a provocar uma vez (resposta bruta mascarada em `.sankhya-raw/`, nunca no Git): CNPJ duplicado direto no ERP; IE ausente em PJ; nome com mais de 100 caracteres (recusa local, sem chamada).

## 5. Critério de parada

Qualquer resposta diferente da esperada, **escrita duplicada**, LIMCRED preenchido, default diferente de 0/0/'I', edição que cria um parceiro novo em vez de alterar o existente, ou coluna `OBSERVACOES` inexistente: parar, **fechar as chaves** (§2, "Fechar de novo"), não repetir, registrar o resultado bruto mascarado em `.sankhya-raw/` e o resumo em `docs/sankhya-spike.md` §9.64 (itens 1 a 4 só mudam de NEEDS VALIDATION para VALIDADO com a evidência do T5), e voltar ao dono. Nenhum retry de recusa permanente. Se o T5 provar que o formato de fio está errado, o conserto fica em um único módulo (`packages/sankhya/src/write/partner-wire.ts`), com novo teste e nova autorização.

## 6. O que fica fora

Produção (nunca), contatos e endereços adicionais (sem mapeamento, S5.2: o Force responde 409 `customer_edit_field_not_supported`), `LIMCRED`, qualquer coluna fora da lista permitida, e qualquer tentativa por cima do Sandbox sem o `-f` descrito em §2.
