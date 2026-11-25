# Cadastro e edição de cliente no Force (Lote 4) — contrato de consumo para site e app

Escopo: o que o servidor entrega para o site e o app. Decisões de origem: D-AR/D-AP/D-AQ (`docs/implementation/customer-write-plan.md`). Autorização do dono (2026-11-25): a porta `updatePartner` e o roteiro T1–T9 valem **somente no Sandbox**; produção nunca. As chaves seguem **FECHADAS por padrão**; só abrem no staging com o override descrito em `docs/implementation/customer-sandbox-runbook.md`. O formato de fio da edição ainda NEEDS VALIDATION (`docs/sankhya-spike.md` §9.64, roteiro T5).

## Estado por rota

| Rota | Estado | Observação |
|---|---|---|
| `POST /customers` (`createCustomer`) | atrás de `ERP_CUSTOMER_ENQUEUE_ENABLED` (padrão `false`, API) e `SANKHYA_CUSTOMER_WRITE_ENABLED` (worker, padrão `false`) | mesma regra para site e app; aceita `correctsRegistrationId` (correção) |
| `PATCH /customers/{code}` (`updateCustomer`) | grava de verdade quando `ERP_CUSTOMER_EDIT_ENABLED=true`; fechada = 409 `customer_edit_disabled` | 202 gravado no outbox, 200 repetição do mesmo pedido |
| `GET /customers/registrations` (`listCustomerRegistrations`) | novo | cadastros feitos pelo Force, com estado |
| `GET /customers/registrations/{registrationId}` (`getCustomerRegistration`) | novo | um cadastro; fora do escopo = 404 |

Todas estão no OpenAPI (`pnpm -s openapi:check` verde) e nos tipos gerados.

## Estados do cliente (iguais aos do pedido)

Um único texto, em `packages/domain/src/customer-state.ts` (`CUSTOMER_STATE_LABELS`, `customerStateLabel`); o contrato devolve o texto pronto em `stateLabel`. Site e app mostram `stateLabel`, nunca montam o texto.

| `state` | `stateLabel` | Quando |
|---|---|---|
| `draft` | Salvo | só no aparelho (app offline); o servidor nunca devolve |
| `awaiting_send` | Aguardando envio | gravado e na fila do worker, inclusive nova tentativa por falha temporária e verificação em andamento |
| `sent` | Enviado ao Sankhya | confirmado e relido; `customerCode` preenchido |
| `needs_correction` | Precisa de correção | recusa DEFINITIVA do Sankhya; `reasonCode`/`reasonMessage` explicam |

Regra firme: **tentativas esgotadas, timeout, ERP fora do ar ou autenticação nunca viram `needs_correction`.** O worker segue tentando (cadência mais lenta de 15 min), sempre verificando antes de reenviar (SNK-4). Um caso estacionado para uma pessoa aparece como `awaiting_send` com `reasonCode: "review_needed"`.

`reasonCode`: `erp_refused`, `document_already_registered` (texto genérico, nunca dados do outro cadastro), `invalid_command`, `review_needed` (lista completa em `CUSTOMER_REASON_CODES`).

## `POST /customers` — resposta e correção

- 201 confirmado dentro da janela de espera, 202 ainda aguardando, 200 repetição do mesmo `clientRequestId`. O corpo traz `registrationId`, `status`, `state`, `customerCode`, `originKey`; o texto (`stateLabel`) e o motivo vêm de `GET /customers/registrations/{registrationId}`.
- Correção: após `needs_correction`, criar de novo com um **novo** `clientRequestId` e `correctsRegistrationId` = id do cadastro recusado. Só o autor, só de cadastro recusado e ainda não corrigido (409 com `details.reason` `registration_not_found`, `registration_not_rejected` ou `registration_already_corrected`). O cadastro corrigido sai da lista padrão.

## `GET /customers/registrations`

- Query: `state` (`awaiting_send`, `sent`, `needs_correction`; opcional), `limit` (1 a 100, padrão 50). Itens (`CustomerRegistrationView`): `registrationId`, `state`, `stateLabel`, `status`, `customerCode`, `originKey`, `document`, `name`, `sellerCode`, `reasonCode`, `reasonMessage`, `correctsRegistrationId`, `createdAt`, `updatedAt`.
- Escopo (P-21): o autor vê os seus; manager/admin veem os dos vendedores que alcançam; seller sem vínculo = 403 `no_seller_scope`; technical/operations 403. Fora do escopo no `GET` por id = 404 (igual a inexistente).
- Use para acompanhar um cadastro `awaiting_send` e para a lista "Precisa de correção".

## `PATCH /customers/{code}`

- Perfis: admin, manager, seller (nunca technical/operations: 403). Escopo de linha = carteira; cliente fora do escopo = **404**, qualquer que seja o corpo.
- Corpo (`UpdateCustomerRequest`, estrito): `clientRequestId` (UUID) e ao menos um de `phone`, `email`, `notes` (aceitam `null` para limpar). `contacts` e `addresses` existem no esquema mas hoje são **recusados com 409 `customer_edit_field_not_supported`** (sem mapeamento validado, S5.2; auditado, nada gravado). Qualquer outro campo (documento, nome, vendedor, tipo, crédito) = **400** `validation_failed`, um item de `details.issues` por campo.
- Respostas (`UpdateCustomerResponse`: `updateId`, `customerCode`, `state`, `stateLabel`, `reasonCode`, `reasonMessage`, `updatedAt`): **202** gravado, estado `awaiting_send`; **200** repetição do mesmo `clientRequestId` com o mesmo conteúdo (devolve o estado atual da edição: `sent` ou `needs_correction` quando já resolvida). Não há rota de consulta separada: reenviar o mesmo pedido é a consulta.
- 409, `details.reason`: `customer_edit_disabled` (chave fechada), `customer_update_in_progress` (já existe edição aberta do cliente), `customer_edit_field_not_supported`; `idempotency_conflict` (mesmo id com outro conteúdo ou de outra conta).
- Entrega: uma linha `customer_update` no `integration_outbox` na mesma transação da auditoria (`customer.update_requested`, só nomes de campo). Só o worker fala com o Sankhya: relê `TELEFONE/EMAIL/OBSERVACOES`; se já estão como pedido, não grava (SNK-4); senão `updatePartner`, relê e confirma, ou estaciona para uma pessoa se a releitura divergir. Recusa definitiva do ERP = `needs_correction` com o motivo. Ao confirmar, o espelho local (`erp_customer`) recebe telefone e e-mail.
- Configuração para a UI: `general.clientEditEnabled` em `GET /configuration/order-entry` = `true` somente quando `ERP_CUSTOMER_ENQUEUE_ENABLED` e `ERP_CUSTOMER_EDIT_ENABLED` estão abertos nesta API; senão `false`. Site e app não mostram a edição enquanto for `false`; `clientCreationEnabled` segue para a criação. Em produção ambas são sempre `false` (a API recusa subir com as chaves fora do staging).

## Contrato compartilhado (`packages/contracts/src/customer-write.ts`)

`CUSTOMER_STATES`, `CUSTOMER_REASON_CODES`, `CustomerStateSchema`, `CustomerRegistrationViewSchema`, `CustomerRegistrationsResponseSchema`, `CustomerContactInputSchema`, `MAX_CUSTOMER_CONTACTS`, `UpdateCustomerRequestSchema`, `UpdateCustomerResponseSchema`. A lista de estados do contrato é conferida contra o domínio por teste (`customer-state-alignment.test.ts`). Validação de CNPJ/CPF e IE (até 16 ou "Isento" para PJ; PF sem IE) fica no esquema de criação existente e no domínio, igual para site e app.

## Banco

Migração `0048_customer_registration_corrects` (expand-only, aditiva): coluna `customer_registration.corrects_registration_id` (nullable, FK própria, no máximo uma correção por cadastro recusado) e índices de consulta. Nenhum dado existente muda.

## O que depende de deploy

Tudo acima funciona no código e nos testes (gateway fake e Postgres real). Em staging só depende de: implantar este lote (a migração roda no deploy), aplicar o override do runbook e rodar o T5 para validar o fio do `updatePartner` (NEEDS VALIDATION). Nada disso foi feito pelo agente.

## Decisões em aberto (não inventadas)

1. Formato de fio do `updatePartner`, coluna `OBSERVACOES` e limpeza de valores: NEEDS VALIDATION (roteiro T5; `docs/sankhya-spike.md` §9.64).
2. Mapeamento de contatos e endereços adicionais no Sankhya (S5.2): sem ele a edição desses campos segue recusada.
3. Tamanhos de colunas de contato/endereço do Sankhya: NEEDS VALIDATION.
4. Regra "IE até 16" (plano §8 vs. item aberto do CHECKPOINT).
5. Endpoint de catálogo CEP / rua-bairro.
6. Aprovação de dispositivo para operations/technical: não existe modelo de dispositivo no servidor; o bloqueio de app é por perfil (`app_not_permitted`).
7. `.env.example`/`deploy/*.env.example` não editados por permissão; o padrão `false` está na validação de ambiente.
