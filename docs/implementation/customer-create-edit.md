# Cadastro e edição de cliente no Force (Lote 4) — contrato servidor

Escopo: o que o servidor entrega hoje para o site e o app. Decisões de origem: D-AR/D-AP/D-AQ (`docs/implementation/customer-write-plan.md`). Nada daqui escreve no Sankhya; as chaves seguem FECHADAS.

## Estado por rota

| Rota | Estado | Observação |
|---|---|---|
| `POST /customers` (`createCustomer`) | existente, atrás de `ERP_CUSTOMER_ENQUEUE_ENABLED` (padrão `false`) e `SANKHYA_CUSTOMER_WRITE_ENABLED` (worker, padrão `false`) | mesma regra para site e app; inalterada neste lote |
| `PATCH /customers/{code}` (`updateCustomer`) | **sempre recusa com 409** | a porta `updatePartner` não existe e não foi aprovada; nada é gravado, nada vai ao outbox, o gateway nunca é chamado |

Ambas estão no OpenAPI (`pnpm -s openapi:check` verde) e nos tipos gerados.

## `PATCH /customers/{code}`

- Perfis: admin, manager, seller (nunca technical/operations: 403). O escopo de linha é o da carteira (`customerScope`): cliente fora do escopo responde **404**, qualquer que seja o corpo.
- Corpo (`UpdateCustomerRequest`, estrito): `clientRequestId` (UUID), e ao menos um de `phone`, `email`, `notes` (aceitam `null` para limpar), `contacts` (até 10), `addresses`. Qualquer outro campo (documento, nome, vendedor, tipo, crédito) é **400** `validation_failed` com um item de `details.issues` por campo recusado (ex.: `path: "document"`).
- Respostas: 202 (`UpdateCustomerResponse`) está no contrato para o dia da aprovação; hoje só 409/400/404/403/401.
- 409, `details.reason`:
  - `customer_edit_disabled`: `ERP_CUSTOMER_EDIT_ENABLED=false` (padrão).
  - `customer_edit_delivery_not_approved`: chave aberta, mas a entrega da edição ao ERP não está aprovada.
- Auditoria: `customer.update_refused` com código do cliente e NOMES dos campos; nunca valores.
- Chave `ERP_CUSTOMER_EDIT_ENABLED`: só com `ERP_CUSTOMER_ENQUEUE_ENABLED=true` e só em staging/dev local (falha no boot caso contrário).
- Configuração para a UI: `general.clientEditEnabled` em `GET /configuration/order-entry`; é `false` hoje, sempre (exige entrega aprovada). Site e app não devem mostrar a edição enquanto for `false`; `clientCreationEnabled` segue valendo para a criação.

## Contrato compartilhado (`packages/contracts/src/customer-write.ts`)

`CUSTOMER_STATES` (`draft`, `awaiting_send`, `sent`, `needs_correction`), `CUSTOMER_REASON_CODES`, `CustomerContactInputSchema`, `MAX_CUSTOMER_CONTACTS`, `UpdateCustomerRequestSchema`, `UpdateCustomerResponseSchema`. Validação de CNPJ/CPF e IE (até 16 ou "Isento" para PJ; PF sem IE) fica no esquema de criação existente e no domínio, igual para site e app.

## Decisões em aberto (não inventadas)

1. Aprovar a porta de escrita `updatePartner` (e o roteiro de Sandbox correspondente). Sem isso a edição nunca é aceita.
2. Tamanhos de colunas de contato/endereço do Sankhya: NEEDS VALIDATION (`docs/sankhya-spike.md`).
3. Confirmar a regra "IE até 16" (plano §8 vs. item aberto do CHECKPOINT).
4. Endpoint de catálogo CEP / rua-bairro.
5. Lista/correção de cadastros (`GET` de cadastros próprios, `correctsRegistrationId`, migração 0048+): NÃO entregue neste lote.
6. Aprovação de dispositivo para operations/technical: não existe modelo de dispositivo no servidor; o bloqueio de app é por perfil (`app_not_permitted`).
7. `.env.example`/`deploy/*.env.example` não editados por permissão; o padrão `false` está na validação de ambiente.
