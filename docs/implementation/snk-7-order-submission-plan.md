# SNK-7 — plano em fatias do envio de pedido ao Sankhya (nota de trabalho)

> Nota de trabalho, **não é registro de decisões**. Autoridade: `docs/decisions.md` SNK-7 (§3.14, D10), SNK-4, SNK-5, SNK-6, CFG-1…6, DISC-3…6, ORD-1, ORD-2 (§3.15, Q12), STACK-2/STACK-6. Fatos do Sankhya: `docs/sankhya-spike.md` §9.38–§9.39 (F-44…F-52). Este documento é o "plano em fatias antes de codar" exigido pelo SNK-7. **Nenhuma linha de código, nenhuma chamada ao Sankhya e nenhum commit** foram feitos para produzi-lo. Tudo que não está validado está marcado **NEEDS VALIDATION** e para aquele ramo.

## 0. Ponto de partida (estado real do código, verificado por grep)

- `packages/sankhya/src/gateway.ts`: `SankhyaWritePort.submitOrder` existe, **intencionalmente não implementado** (`NotImplementedError`); `SubmitOrderRequest` é provisório (`originId`, `customerCode`, `sellerCode`, `items`) e o próprio comentário diz para não construir em cima dele.
- `packages/db/src/schema/integration.ts`: `integration_outbox` já tem `aggregate_type/id`, `operation`, `payload`, `origin_id` (único, anulável), `status`, `attempt_count`, `next_attempt_at`, `last_error_class/message`, `erp_reference`. Status do banco hoje: `pending | processing | confirmed | rejected | unknown`. Há gatilho `integration_outbox_order_gate` e check `sales_order_erp_eligibility_chk` que recusam pedido legado/fake/não vinculado.
- `apps/server/src/orders/erp-eligibility.guard.ts`: `assertEligibleForErpSubmission` pronto, **sem chamador** ("o futuro escritor DEVE chamá-lo").
- `apps/server/src/worker/queues.ts`: registro de filas pg-boss (dead-letter, heartbeat, `sync.mirror.<entidade>`); nenhuma fila de entrega de pedido. Regra: a fila nova entra no registro e o `queue:install` a cria antes da versão nova.
- Contrato de pedido (`packages/contracts/src/orders.ts`): `OrderStatus = draft | cancelled | queued | sent | rejected | unknown`.

## 1. O contrato provado no S3 (e o que NÃO está provado)

VALIDATED (env, Sandbox, **um** pedido): `CACSP.incluirNota` aceitou o conjunto de campos de F-44 (cabeçalho: `CODPARC`, `DTNEG` dd/MM/yyyy, `CODTIPOPER` 1001, `CODTIPVENDA` 11, `CODVEND`, `CODEMP` 1, `TIPMOV` P, `OBSERVACAO`; itens: `INFORMARPRECO` "False", `CODPROD`, `QTDNEG`, `CODLOCALORIG`, `CODVOL`); resposta `status` "1" com `pk.NUNOTA` (F-44); pedido nasce pendente `STATUSNOTA` A / `PENDENTE` S, sem `TSILIB` (F-45); preço do item = preço de lista (F-46, um caso); total com IPI inferido (F-47, HIPÓTESE); título financeiro síncrono (F-48); leitura 300 ms depois (F-49); `cancelarNota` é no-op em pedido pendente, `excluirNotas` remove (F-50/F-51).

**NEEDS VALIDATION (bloqueia gravação real, SNK-6/V-11/V-13):** gravar o campo de origem dedicado (SNK-5; definição PROPOSTA; F-52 só leu o dicionário e não há índice → consulta por origem é full-scan); idempotência nativa; formato do erro de negócio e de indisponibilidade/rate limit/auth em `incluirNota` (só 200 foram vistos); mínimo real de campos; TOP/empresa/pagamento como escolha de negócio (vêm de configuração CFG, nunca literais); desconto (`PERCDESC`) na gravação; confirmação (`confirmarNota`) e quem confirma; cancelamento de pedido confirmado. **Cada teste de gravação real exige autorização própria do dono (SNK-6).** Este plano não autoriza nenhuma.

## 2. Mapeamento de nomes (SM-2 / SM-7 / ORD-2 / contrato)

| Blueprint (SM-2) | Contrato `OrderStatus` | Observação |
|---|---|---|
| `aprovado` → `na_fila` | `queued` | outbox criada na mesma transação (Trilha B entrega `approved`/estados de aprovação) |
| `enviado` | `sent` | `erp_reference` = NUNOTA gravado no pedido |
| `erro_integracao` | `rejected` (ORD-2: "`rejected` continua sendo a rejeição do envio ao ERP") | **dúvida do dono D-2** para esgotamento por erro temporário |
| `cancelado` | `cancelled` | fora desta trilha |

| Blueprint (SM-7) | Banco hoje (`OutboxStatus`) | Observação |
|---|---|---|
| `pendente` | `pending` | |
| `processando`, `verificando_origem`, `enviando` | `processing` | sub-etapas são passos internos/log, não estados persistidos (**NEEDS DECISION**, D-3) |
| `aguardando_retry` | `pending` + `next_attempt_at` futuro | |
| `entregue`, `vinculado_existente` | `confirmed` (+ `erp_reference`) | `vinculado_existente` distinguido por marcador no registro |
| `erro` | `rejected` | permanente ou tentativas esgotadas |
| (resultado ambíguo) | `unknown` | ver slice 4 |

Qualquer mudança de nomes ou novo valor de status exige migração expand→migrate→contract (P-16) pelo `database-engineer`.

## 3. Ordem das fatias e dependências

```
S1 flag+boot ──► S2 allowlist ──► S3 contrato do gateway/ fake ──► S4 dry-run ──► S5 consumidor do outbox ──► S6 idempotência/origem
                                                                                         │                          │
Trilha B (alçada/estados) ──► S7 recálculo na fila ──────────────────────────────────────┘                          ▼
                                                                         S8 estados+erros ──► S9 número Sankhya ──► S10 reprocessar (W-32)
                                                                                     (gravação real só depois de V-11/V-13 + autorização)
```

Dependências com a **Trilha B** (alçada DISC-3…6 / estados ORD-2): a Trilha B é dona dos estados de aprovação de `orders`, da tabela de limites e do cálculo de status de desconto no domínio (`packages/domain`). Esta trilha **não** cria estados de aprovação, não altera a máquina de estados do pedido além de `queued/sent/rejected` e **consome** a função de domínio de alçada (S7). Arquivos a não tocar sem alinhar: `packages/domain` (alçada/estado do pedido), migrações de `orders`, `apps/server/src/orders/*` exceto o gancho de enfileiramento. Se a Trilha B ainda não entregou o cálculo, S7 fica bloqueada (as demais seguem). Migrações de `integration_outbox` e `orders` precisam ser sequenciadas com a Trilha B (mesmo `database-engineer`, uma de cada vez).

---

## Fatia S1 — Flag `SANKHYA_ORDER_WRITE_ENABLED` (desligada por padrão) e validação no boot

- **Escopo:** variável de ambiente, padrão `false`; só o worker a lê. Validada no boot com falha rápida: valor inválido derruba o processo; `true` exige `SANKHYA_BASE_URL` na allowlist (S2), ambiente declarado não-produção e `NODE_ENV`/`APP_ENV` não igual a produção; `true` em staging/produção é recusado no boot salvo decisão futura do dono (SNK-7: nunca ligada em staging por agente). Estado exposto (sem segredo) na página de saúde da integração (apenas "escrita de pedido: desligada/ligada-Sandbox").
- **Arquivos prováveis:** esquema de configuração do worker em `apps/server/src/config/*` (localizar com grep), `.env.example` (placeholder `false`), `deploy/*` só documenta, **não** muda valores.
- **Testes (TDD, primeiro):** ausente→desligada; `"true"/"1"` aceitos conforme padrão do projeto, lixo→erro; ligada com host fora da allowlist→boot falha; ligada em env de produção/staging→boot falha; API process nunca carrega a flag nem credenciais (STACK-2).
- **Pronto quando:** testes verdes; `.env.example` sem valor ligado; nenhum default `true` em nenhum arquivo `deploy/`.
- **Riscos:** flag lida em dois lugares divergentes; mitigação: um único leitor tipado.

## Fatia S2 — Allowlist de host (somente Sandbox)

- **Escopo:** função pura `assertSandboxHost(url)` em `packages/sankhya`: aceita **exatamente** `placfestas-teste.sankhyacloud.com.br` e `api.sandbox.sankhya.com.br`, esquema `https`, sem credenciais embutidas na URL, sem porta alternativa, comparação do hostname normalizado (minúsculo, sem ponto final, sem punycode/IDN, sem sufixo/prefixo enganoso do tipo `placfestas-teste.sankhyacloud.com.br.evil.com`). Aplicada em **toda** requisição de escrita no ponto único de saída HTTP do cliente real (não só no boot), inclusive após redirecionamento (redirecionamento cross-host recusado). Qualquer outro host: erro permanente local, **sem** contato de rede, registrado.
- **Arquivos prováveis:** `packages/sankhya/src/write-host-allowlist.ts` (novo), uso no cliente HTTP real de `packages/sankhya/src/*`; a lista é constante no código (SNK-7 fixa os hosts) — não configurável por ambiente.
- **Testes:** hosts permitidos passam; domínio de produção do Sankhya, subdomínios parecidos, IP, `localhost`, `http://`, userinfo, porta, maiúsculas, ponto final, redirecionamento 30x para outro host → todos recusados; teste de que nenhuma requisição de rede é feita na recusa (cliente HTTP injetado/espião). Teste de arquitetura: escrita só passa pelo ponto único.
- **Pronto quando:** testes verdes e revisão de segurança (`security-model.md` §15: produção/credenciais).
- **Riscos:** o host de produção real do cliente PLAC não é conhecido neste plano e **não** deve ser digitado; a defesa é lista **permitida**, nunca lista negada. NEEDS VALIDATION: se o mesmo host `placfestas-teste` serve também leituras de produção do tenant — não assumir.

## Fatia S3 — Contrato de escrita do gateway e fake (sem rede)

- **Escopo:** redesenhar `SubmitOrderRequest/Result` com tipos Sales Force: `originId` (UUID do pedido, U-07), cliente, vendedor, empresa/TOP/tipo de pagamento **vindos da configuração** (CFG-1…6), itens com código de produto, quantidade, unidade/local (de configuração/espelho — NEEDS VALIDATION de onde vêm `CODLOCALORIG`/`CODVOL`), desconto por item (NEEDS VALIDATION de semântica no Sankhya); resultado `{ externalOrderId, outcome: 'created' | 'linked_existing' }`; erros tipados com classe (S8). Mapeador puro `mapOrderToIncluirNota` fica **dentro** de `packages/sankhya` (nenhum nome de serviço/tabela cruza a interface). `FakeGateway` implementa o mesmo contrato com cenários configuráveis (sucesso, duplicado, validação, indisponível, auth, rate limit, resposta ambígua) e fixtures sanitizadas derivadas de F-44 (sem dados reais; proveniência S3/§9.38). O cliente real **continua recusando** enquanto V-11/V-13 estiverem abertos; a recusa passa a depender da flag + S2 + um segundo interruptor "gates fechados" (ver D-1).
- **Testes:** testes de contrato compartilhados fake×real-mock; mapeamento golden com a fixture; resposta com `status` ≠ "1" é erro tipado; Zod valida a resposta (regra do projeto); erro desconhecido → classe `unknown`, nunca "sucesso".
- **Pronto quando:** contrato do gateway estável; `describe()` reflete `writes.submitOrder`; nenhum teste usa rede.
- **Riscos:** mapeamento de campos além de F-44 é invenção — manter lista fechada; campo faltante = NEEDS VALIDATION, não suposição. Formato de erro do `incluirNota` não foi observado (só 200): classificação de erro real é parcialmente teórica até um teste autorizado.

## Fatia S4 — Modo dry-run (grava o payload, não envia)

- **Escopo:** `SANKHYA_ORDER_WRITE_MODE = off | dry_run | live` (padrão `off`; `live` só com flag S1 ligada + allowlist + gates). Em `dry_run` o worker monta o payload final, valida (Zod + mapeador), grava-o **sanitizado** em registro auditável (coluna/tabela de tentativa ou campo no outbox — modelagem pelo `database-engineer`) com o hash do payload, marca a tentativa como `dry_run`, **não chama a rede** (o cliente de escrita nem é instanciado) e **não** muda o pedido para `sent`. Documento "dry-run" em `docs/` descrevendo o procedimento, o que é conferido (campos, origem, valores de configuração, totais) e o critério para autorizar a primeira gravação real, **escrito e revisado antes** de qualquer escrita real (exigência do SNK-7).
- **Arquivos prováveis:** `packages/sankhya` (modo no cliente), módulo `integration` do worker, doc em `docs/implementation/` ou `docs/sankhya-spike.md` §8/§9 (registro quando executado).
- **Testes:** dry-run nunca chama o cliente HTTP (espião com contagem 0); payload gravado não contém segredo, token nem PII além do necessário (UUID/códigos); dry-run repetido é idempotente (mesmo hash, sem duplicar linha); `live` sem gates recusa.
- **Pronto quando:** pedido de teste sintético gera payload revisável; o dono lê o documento e confirma.
- **Riscos:** payload com dados pessoais de cliente real em log — gravar códigos, não nomes; retenção do registro (NEEDS DECISION, D-6).

## Fatia S5 — Consumidor do `integration_outbox` (worker + pg-boss)

- **Escopo:** fila pg-boss `integration.order.submit` registrada em `QUEUE_REGISTRY` (política de retry própria; `queue:install` cria antes da versão). Enfileirar o job **na mesma transação** que cria a linha de outbox e move o pedido para `queued` (STACK-6) — essa transação é do módulo de pedidos/Trilha B; esta trilha entrega o serviço `OrderOutboxEnqueuer`. Varredura periódica recria jobs perdidos (SM-7 "proposto"). O handler: carrega a linha (`FOR UPDATE SKIP LOCKED`), exige flag/modo, chama `assertEligibleForErpSubmission` (lido da linha, nunca da requisição), marca `processing`, **nunca chama a rede dentro de transação de banco**, aplica S6 e S8, grava o resultado em transação curta. Handler idempotente: reentrega do mesmo job não gera segunda escrita (guarda por `status`/`origin_id` + S6). Espaçamento: requisições serializadas enquanto os limites do §5 do spike não forem medidos (regra do projeto).
- **Arquivos prováveis:** `apps/server/src/worker/queues.ts` (registro), novo módulo `apps/server/src/integration/order-delivery/*` (handler, selector), `apps/server/src/orders/*` (só o gancho de enfileiramento, coordenado com Trilha B), testes em `apps/server/test/integration/*` (Testcontainers).
- **Testes (Testcontainers, PostgreSQL real):** job duplicado/concorrente processa uma vez; crash entre claim e resultado deixa estado recuperável (volta a `pending` após tempo limite ou fica `unknown`, ver S6); pedido não elegível é recusado pelo guard e pelo gatilho do banco; transação do enfileiramento reverte tudo se falhar (sem job órfão); varredura recria job perdido; handler com fake gateway cobre todos os cenários do S3.
- **Pronto quando:** com `mode=dry_run` e fake gateway, um pedido aprovado percorre fila→handler→registro de dry-run, sem rede; suíte do worker verde.
- **Riscos:** pooler/pg-boss (V-16); lock por linha vs. SKIP LOCKED sob muitas tentativas; ordem entre pedidos do mesmo cliente é irrelevante (não ordenar por UUID, DATA-3).

## Fatia S6 — Idempotência por pedido: verificar o campo de origem ANTES de qualquer reenvio

- **Escopo:** `origin_id` = UUID do pedido (U-07), estável entre tentativas, nunca id de job/tentativa; gravado na linha de outbox na criação (índice único já existe). Fluxo no handler antes de **todo** envio e reenvio (inclusive a primeira tentativa): estado `verificando_origem` → consulta de leitura ao Sankhya por igualdade exata no campo de origem dedicado → se encontra: **vincular** (`erp_reference` = NUNOTA existente, não reenviar, resultado `linked_existing`); se não encontra: enviar com o campo de origem preenchido na mesma chamada. **Sem heurística** (cliente/data/total rejeitados pelo SNK-4). Resposta ambígua (timeout depois do envio, 5xx, conexão cortada) → estado `unknown`, **proibido reenviar** até a verificação de origem concluir positiva ou negativa; verificação indisponível → permanece em retry de verificação, nunca vai direto a reenvio. Observação (`OBSERVACAO`) só como contingência por autorização explícita e registrada do dono para aquele incidente (SNK-4, U-05/U-06) — não implementada por padrão.
- **BLOQUEADO / NEEDS VALIDATION:** qual campo é o de origem dedicado (SNK-5 PROPOSTO; nunca `AD_VDYORIG`/`AD_NUVIDYA`); se `incluirNota` grava um `AD_` no cabeçalho; desempenho da consulta (sem índice = full-scan, F-52) e limite do serviço de leitura; idempotência nativa (V-13). Até lá: implementar contra o **fake** (campo de origem simulado) e deixar o cliente real recusando.
- **Testes:** (regressão, antes do código) reenvio após timeout com pedido já criado → vincula, uma só escrita no fake; origem encontrada na 1ª tentativa; verificação falha → não envia; duas execuções concorrentes → uma escrita (unicidade do `origin_id` + lock); nenhuma tentativa usa id de job; payload sempre carrega o mesmo `originId`.
- **Pronto quando:** propriedade "no máximo uma criação por `origin_id`" provada no fake sob falhas injetadas; fechamento de V-11/V-13 registrado no spike antes de qualquer `live`.
- **Riscos:** o maior do plano. Falso-negativo da leitura logo após escrita (read-your-write: ~300 ms foi observado em um caso, F-49, sem garantia sob carga, S0.2) → janela mínima antes de concluir "não existe" após resposta ambígua (valor NEEDS VALIDATION).

## Fatia S7 — Recálculo da alçada de desconto a partir das linhas gravadas antes de enfileirar

- **Escopo:** na transição para `queued`, o serviço relê as **linhas gravadas** do pedido (nunca o payload da requisição/cliente), recalcula o status de desconto com o papel do **dono do rascunho** (DISC-5), limites inclusivos `<=` (Q7), base = preço efetivo do item na tabela do cliente/fallback registrada no pedido (Q10), teto = limite do diretor (Q13/Q9), e só enfileira se `approved`/dentro da alçada ou aprovado por ação explícita auditada (DISC-5/DISC-4); acima do teto: pedido permanece salvo e `blocked`, só o envio é recusado (Q12). Preço ausente ≠ 0 ("Sem preço", CFG-4/5) impede o envio. Usa a **função de domínio da Trilha B**; esta trilha só a chama dentro da mesma transação da criação do outbox e **reconfere** no handler (defesa em profundidade) sem reimplementar regra.
- **Arquivos prováveis:** chamada em `apps/server/src/orders/*` (gancho), teste de integração; nada novo em `packages/domain` (é da Trilha B).
- **Testes:** linha editada entre aprovação e envio (desconto aumentou) → recálculo recusa e devolve a rascunho/aprovação (ORD-1: edição invalida aprovação pendente); igual ao limite passa; acima do teto fica `blocked`; sem preço bloqueia; tentativa de enfileirar com status enviado pelo cliente é ignorada.
- **Pronto quando:** não é possível produzir linha de outbox para pedido cuja alçada recalculada não permita (teste de banco + serviço).
- **Riscos:** dependência direta da Trilha B (nomes dos estados de aprovação e função de alçada); valores PLAC provisórios 5/15/30 (Q11) não são regra definitiva.

## Fatia S8 — Estados `queued/sent/rejected` e classificação de erros

- **Escopo:** transições (mapeamento da §2): `queued` → `sent` (sucesso ou `linked_existing`), `queued` → `rejected` (erro permanente ou tentativas esgotadas), erro temporário mantém `queued` com `next_attempt_at` (backoff exponencial, até 8 tentativas, RF-SNK-3). Classes (as mesmas de `architecture.md` §5.3): **indisponível** (rede/5xx/timeout → temporário, retry), **auth** (token expirado → renovar uma vez; falha persistente → classe própria, alerta, sem consumir tentativas de negócio), **autorização** (permissão do usuário técnico → permanente até correção de configuração), **validação** (rejeição de negócio do Sankhya → permanente, mensagem traduzida), **rate limit** (backoff respeitando `Retry-After` se existir — NEEDS VALIDATION, nunca visto), **temporário**, **permanente**; resposta desconhecida → `unknown` (nunca "permanente" nem "sucesso"). `last_error_class/message` guardam classe e texto traduzido (sem payload bruto). Mensagem ao vendedor compreensível; detalhe técnico só para admin/log. Mapeamento de códigos reais do Sankhya para classes: **NEEDS VALIDATION** (não foi observado erro de `incluirNota`); fica uma tabela de mapeamento no pacote, com default conservador "não reenviar".
- **Testes:** tabela de decisão classe→(retry? estado final) exaustiva; 8ª tentativa vai a erro; permanente nunca reagenda; `unknown` nunca reenvia (liga com S6); backoff com relógio injetado; log não contém segredo.
- **Pronto quando:** transições auditadas e testadas; pedido nunca fica `queued` para sempre (máx. tentativas ou tempo).
- **Riscos:** o status do banco (`pending/processing/confirmed/rejected/unknown`) e o do pedido têm que andar juntos na mesma transação; ver D-2 e D-3.

## Fatia S9 — Número Sankhya gravado no pedido (RF-ORD-7 mínimo)

- **Escopo:** ao sucesso/vínculo, na mesma transação do resultado: `erp_reference` no outbox **e** número do pedido no Sankhya (NUNOTA, de `responseBody.pk.NUNOTA`, F-44) em coluna própria de `orders` (nome/tipo pela `database-engineer`; texto ou inteiro — NEEDS DECISION de modelagem). Exposto em DTO explícito do detalhe do pedido (W-22) e na lista, apenas para quem enxerga o pedido; sem custo/margem (P-20). **Fora do mínimo:** data de faturamento e nota fiscal (RF-ORD-7 completo depende do vínculo pedido→notas do S3/R24/R25, NEEDS VALIDATION) e estados `confirmado/faturado*`.
- **Testes:** número gravado só em `sent`; imutável depois; DTO inclui para o escopo permitido e não vaza em escopo negado; replay do mesmo resultado não altera.
- **Pronto quando:** pedido `sent` mostra o número no detalhe e na lista.
- **Riscos:** o pedido no Sankhya nasce **pendente** (F-45) — mostrar "enviado" ≠ "confirmado/faturado"; texto da UI deve dizer "Enviado ao ERP", sem sugerir confirmação.

## Fatia S10 — Reprocessar auditado (W-32)

- **Escopo:** ação "Reprocessar" para admin (RF-SNK-5): `rejected`→`pending` (SM-7 `erro → pendente`) somente se classe reprocessável; **sempre** repassa por S6 (verificação de origem antes do reenvio — reprocessar nunca é "enviar de novo às cegas"); permanente de validação só após correção do pedido (edição → volta a rascunho pela ORD-1, não pelo botão); registra auditoria na mesma transação (quem, quando, motivo obrigatório, estado anterior/novo, `origin_id`). Lista W-32: tipo, entidade, origem (UUID), tentativas, classe, mensagem, atualizado; filtros tipo/classe/estado/período; permissão restrita a administrador, servidor-side (P-21). Endpoint via contratos Zod → OpenAPI → cliente gerado; UI em `apps/web` (frontend-engineer, fora desta trilha de plano).
- **Testes:** matriz de autorização (admin sim; vendedor/gerente/técnico/representante não); reprocessar duas vezes seguidas → uma só retomada (idempotente); auditoria gravada ou ação inteira reverte; reprocessar item com origem já existente no ERP → vincula, não duplica (fake).
- **Pronto quando:** fluxo erro→reprocessar→`sent`/`linked_existing` provado no fake com auditoria.
- **Riscos:** botão usado para contornar erro permanente de dado; o motivo obrigatório e a regra de classe reduzem isso. Cancelar entidade pendente no outbox (SM-7 "não especificado") não é tratado — D-5.

---

## 4. Ordem recomendada de execução

1. S1, S2 (puras, sem dependências, revisão de segurança). 2. S3 (contrato + fake). 3. S4 (dry-run + documento). 4. S5 (consumidor) e, em paralelo condicional, S7 após a Trilha B publicar a função de alçada. 5. S6, S8 (sobre o fake). 6. S9, S10. 7. **Portão:** nada disso liga `live`; a primeira gravação real exige: V-11/V-13 fechados e registrados no spike, SNK-5 aprovado (campo de origem), documento de dry-run revisado, segurança aprovada, rotação de credenciais (SEC-1) e **autorização escrita do dono para aquele teste** (SNK-6).

## 5. O que o dono roda (somente descrito; nunca com segredo)

- Rotação das credenciais do Sandbox (SEC-1) e injeção no ambiente do worker local: feito pelo dono fora do Git; o agente nunca vê nem grava o valor.
- Definição/criação do campo de origem dedicado no Sankhya Sandbox (SNK-5) com o parceiro Sankhya, e informar o nome ao projeto.
- Ligar `SANKHYA_ORDER_WRITE_ENABLED` e `SANKHYA_ORDER_WRITE_MODE` **somente na máquina local do dono**, primeiro `dry_run`, depois `live` contra o Sandbox, por comando do dono (variáveis de ambiente de sessão, valores de credencial lidos do ambiente, nunca digitados em arquivo). Staging permanece desligado.
- Executar a suíte do worker/integração e o dry-run sintético com os scripts reais do repositório (verificar `package.json` antes; este plano não inventa comandos).
- Conferir o resultado do dry-run (payload gravado) e aprovar por escrito a primeira escrita real.

## 6. Decisões do dono (nada abaixo foi decidido por este plano)

- **D-1 — Segundo interruptor de gates.** Além da flag (S1), a escrita real deve exigir um marcador explícito "gates SNK-4/V-11/V-13 fechados" (ex.: segundo flag ou registro no spike lido no boot)? Recomendação: sim, para a flag sozinha nunca bastar.
- **D-2 — Esgotamento de tentativas por erro temporário** (Sankhya fora do ar por muito tempo): o pedido vai a `rejected` (nome ORD-2 para falha de envio) ou fica `queued` indefinidamente com alerta, ou usa `unknown`? Hoje o contrato tem `unknown`; significado a confirmar.
- **D-3 — Granularidade dos estados do outbox:** manter os 5 valores do banco (`pending/processing/confirmed/rejected/unknown`) com sub-etapas só em log, ou persistir `verificando_origem/enviando/aguardando_retry/vinculado_existente` do SM-7? (migração com expand→contract.)
- **D-4 — Pedido gravado como pendente no Sankhya (F-45):** quem confirma o pedido no ERP (backoffice manualmente vs. Sales Force chamando `confirmarNota`, que não foi testado)? Define se `sent` significa "incluído pendente". **NEEDS VALIDATION** + autorização para teste.
- **D-5 — Cancelar pedido enquanto `queued`/em retry** (SM-7 "não especificado"): permitido? E cancelar pedido já `sent` (reflete o Sankhya; cancelamento de pedido confirmado não foi testado).
- **D-6 — Retenção e sanitização do registro de dry-run** (por quanto tempo e quais campos).
- **D-7 — Desconto na gravação:** como o desconto negociado deve chegar ao Sankhya (`PERCDESC` por item vs. preço unitário já com desconto)? Semântica não validada (S2/S3); precisa de teste de gravação autorizado.
- **D-8 — Valores de configuração para o pedido** (empresa, TOP, tipo de pagamento, local/unidade): TOP 1001 / empresa 1 / pagamento 11 foram só o que funcionou no teste; a escolha de negócio vem do dono via configuração CFG, nunca de literal.
- **D-9 — Limites provisórios 5/15/30 (Q11):** valores PLAC definitivos antes de qualquer uso real do recálculo S7.
- **D-10 — Autorização para o primeiro teste real de gravação com origem** (SNK-6: cada teste precisa da sua): escopo, número de pedidos, limpeza (`excluirNotas`) e orçamento de requisições.
