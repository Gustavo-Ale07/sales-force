# SNK-7 — Roteiro do dry-run e do teste #1 no Sandbox (D-10)

Status: PREPARADO, NÃO EXECUTÁVEL. Nada deste documento pode rodar sem o "AUTORIZO" escrito do dono, depois de revisar o dry-run (D-10). Nenhuma etapa foi executada; nenhuma chamada ao Sankhya foi feita ao preparar este roteiro (SNK-3, SNK-6). Revisado em 2026-11-04 (parte 2b: IPI estimado D-D, financeiro D-I, expedição D-O, mascaramento D-Q).

Decisões: SNK-7 D-1..D-10 (`docs/decisions.md` §3.16), SNK-4 (idempotência), SNK-5 (campo de origem dedicado), SNK-6 (comporta de escrita), SNK-3 (produção nunca é tocada); D-D, D-O, D-P, D-Q (`docs/decisions.md`, 2026-11-03). Fatos e pendências do Sankhya: `docs/sankhya-spike.md` §9.38 e a seção da parte 2b.

## 1. Pré-condições (todas do dono; nada aqui é feito pelo agente)

1. Credenciais do spike rotacionadas (SEC-1); nenhuma credencial entra em Git, em compose ou neste documento.
2. Campo de origem dedicado: `TGFCAB.AD_FORCEORIGEM VARCHAR2(100)`, anulável (VALIDADO no Sandbox, DBExplorer, 2026-11-03). O nome entra só em `SANKHYA_ORDER_ORIGIN_FIELD=AD_FORCEORIGEM` no `compose.env` do worker, que só o dono edita (nunca `AD_VDYORIG`/`AD_NUVIDYA`, SNK-5).
3. Confirmados no Sandbox (hoje NEEDS VALIDATION): forma do `confirmarNota`; corpo de erro do `incluirNota`; valor de `IGNOREDESCPROMOQTD`; lista de vários itens; `PERCDESC` com `INFORMARPRECO` falso; colunas relidas de TGFITE; `CODLOCALORIG` 209; significado de `AD_EXPEDICAO` (S/N; na produção do Vidya vale S em 3.189 de 3.417 notas — o significado ainda deve ser confirmado pelo dono).
4. Pré-requisitos do staging já aplicados pelo dono (ver "Só o dono roda" em `.claude/work/CURRENT.md`): deploy com `SF_RUN_DB_ROLES=1` (novas tabelas e GRANTs), arquivo-base e config-bootstrap atualizados, `sync-once` de `ipiRates` e `openTitles` executado.
5. Dry-run revisado pelo dono (seção 2) e "AUTORIZO" escrito, citando este documento e o orçamento (seção 4).
6. Host: somente `placfestas-teste.sankhyacloud.com.br` ou `api.sandbox.sankhya.com.br` (lista fixa no código). Produção, staging e CI nunca.

## 2. Fase 1 — dry-run (sem rede para o Sankhya)

O worker, com a chave de escrita em modo `dry_run`, monta a requisição de cada pedido enfileirado e a grava em `integration_order_dry_run` (D-6): apenas códigos, UUIDs, quantidades e valores; `OBSERVACAO` substituída pelo hash; sem token, nome, CPF/CNPJ; retida 30 dias e removida pelo job `integration.order.dry-run-purge`. Nenhum pedido é enviado e nenhum token é pedido. Qualquer texto de erro gravado passa pelo mascaramento (D-Q): sem Authorization, token, senha, URL com credenciais nem host do Sankhya.

**D-Z — o dry-run é terminal.** Ao gravar o registro, o outbox passa a `dry_run` (não é mais reprocessado, libera o id de origem) e o pedido volta a `draft`, mostrando "Simulado em dd/mm hh:mm — não enviado" (data e hash vêm de `integration_order_dry_run`; somem após os 30 dias da retenção). Nada simulado é enviado ao virar o modo `live`: o envio real exige novo "Enviar ao Sankhya", que cria um registro novo. As migrações 0026 (status) e 0027 (converte os registros já parados, como o pedido 7) são aplicadas pelo dono.

**Contrato (L1):** em `itens`, `INFORMARPRECO` é atributo e string pura (`"INFORMARPRECO": "False"`, não `{"$": "False"}`); `IGNOREDESCPROMOQTD` continua `{"$": "true"}` em cada item. Fonte: exemplo oficial developer.sankhya.com.br/reference/post_incluimovimentos. O registro do dry-run reflete exatamente isso.

O registro do dry-run mostra o cabeçalho completo, incluindo `CODPARCTRANSP` (transportadora, quando houver) e `AD_EXPEDICAO='N'` (D-O: o pedido nasce sem expedição marcada; o valor vem de `sales.expedicaoDefault`, piloto "N"). O IPI estimado (D-D) **não** aparece no payload nem na validação; é apenas informativo.

O dono revisa as duas requisições (pedidos A e B abaixo) contra o contrato de `incluirNota` e aprova ou pede ajuste.

## 3. Fase 2 — teste #1 (somente após "AUTORIZO" escrito)

Pedido A: 1 item, sem desconto, TOP 1001, condição à vista (negociação 11), com transportadora e `AD_EXPEDICAO='N'`.
Pedido B: 1 item com 8 % de `PERCDESC`, TOP 1001, negociação 2, com transportadora e `AD_EXPEDICAO='N'`.

Expectativa do pedido B (EXIGELIB): no Sandbox, `TGFTOP.EXIGELIB` da TOP 1001 vale N (não exige liberação). **Não se afirma que o desconto de 8 % passa sem evento de liberação nem que o Sandbox o bloqueia**: o que o Sandbox faz com a liberação do pedido B é registrado, não esperado (nota aceita direto, ou evento de liberação em `TSILIB` com o código lido). O resultado entra em `docs/sankhya-spike.md` e não é critério de reprovação. Se aparecer evento, o Force o mostra (vendedor e gestor, D-P) como "pendente: liberação exigida pela TOP" (evento 44) ou "evento N" quando o nome não está em `erp.liberationEventLabels`.

Sequência:

1. `incluirNota` do pedido A, depois `confirmarNota` (dois passos idempotentes, D-4). Reler a nota (D-7) e comparar: `VLRUNIT`, `PERCDESC` e `VLRIPI` (o IPI estimado pelo Force é só informativo: divergência de IPI é registrada, não reprova); ler também `AD_FORCEORIGEM` (= UUID do pedido), `AD_EXPEDICAO` (= `N`) e `CODPARCTRANSP` (= transportadora escolhida), além de itens e quantidades.
2. `incluirNota` e `confirmarNota` do pedido B. Reler e conferir os mesmos campos, com `PERCDESC` = 8.
3. Reenvio do pedido A (mesma chave de idempotência e mesma origem): o worker consulta primeiro a origem (`findOrderByOrigin`), encontra a nota e apenas a vincula. Critério de aprovação: nenhuma segunda nota criada (SNK-4).

   **Como fazer (M1).** Antes não havia caminho seguro: um pedido `sent` não volta à fila por nenhuma tela ou comando, e editar o banco à mão foi proibido. Agora existe um comando operacional, só no contêiner do worker, que não fala com o Sankhya e não escreve no ERP: ele devolve à fila a MESMA linha do outbox (mesmo id, mesma origem = a chave de idempotência) e o pedido a `queued`, com auditoria `order.erp_resend_requested`. O worker em execução então consulta a origem, encontra a nota e apenas a vincula (`linked_existing`). Recusa-se quando o modo de escrita não é `live`, quando o pedido não está `sent` com número ERP, ou quando a última entrega não está `confirmed`.

   ```
   deploy/scripts/sf-compose.sh exec worker node dist/ops-order-resend.js <id-do-pedido-A>
   ```

   Saída esperada: `re-queued: outbox=… origin=… erpNumber=…`. Em até um ciclo do worker o pedido volta a `sent` com o mesmo número; conferir que `incluirNota` foi chamado uma única vez (registro da linha do outbox e contagem de requisições).
4. Limpeza: `excluirNotas` das notas criadas; se recusado, `cancelarNota` como alternativa. Registrar o resultado em `docs/sankhya-spike.md`.

Interrupção imediata (sem nova tentativa) em: erro de autenticação, resposta fora do contrato, qualquer segunda nota para o mesmo UUID, ou uso do orçamento.

## 4. Orçamento

No máximo 40 requisições ao Sandbox em todo o teste (token, consultas de origem, inclusões, confirmações, releituras, limpeza). O worker não deve ultrapassar; ao chegar a 40 o teste termina e o dono decide.

## 5. Seção do dono — comando que HABILITARIA a escrita no Sandbox (DESATIVADO)

Não executar. Registrado apenas para que o dono saiba o que seria alterado, depois do "AUTORIZO". As variáveis são do worker (a API nunca recebe credenciais do Sankhya, STACK-2); os valores sensíveis vêm do cofre do dono, não deste repositório.

```
# DESATIVADO — exige "AUTORIZO" escrito do dono (D-10)
SANKHYA_ORDER_WRITE_ENABLED=true
SANKHYA_ORDER_WRITE_MODE=live
SANKHYA_ORDER_WRITE_GATES_CLOSED=1
SANKHYA_ORDER_ORIGIN_FIELD=AD_FORCEORIGEM
SANKHYA_ENVIRONMENT=sandbox
SANKHYA_MODE=live
SANKHYA_BASE_URL=<um dos dois hosts do Sandbox>
```

### 5.1 Como o dono liga (arquivo de override fora do repositório)

A comporta é o **ambiente de implantação**, não o `NODE_ENV` (I1, 2026-11-04): o staging roda com `NODE_ENV=production` por desenho, e o compose de staging passa `SF_DEPLOY_ENVIRONMENT=staging` à API e ao worker. `ERP_ORDER_ENQUEUE_ENABLED=true` na API e `SANKHYA_ORDER_WRITE_ENABLED=true` no worker só são aceitos com `SF_DEPLOY_ENVIRONMENT=staging` (com `production`, ou com a variável vazia sob `NODE_ENV=production`, o processo recusa subir). No worker isso se SOMA às comportas do modo `live` (host na lista do Sandbox, `SANKHYA_ENVIRONMENT=sandbox`, `SANKHYA_ORDER_WRITE_GATES_CLOSED=1`, campo de origem): nada foi afrouxado.

O arquivo vive só no servidor, **`/opt/force-staging/config/compose.write-sandbox.yml`**, nunca em Git, e é passado com `-f` ao `deploy/scripts/sf-compose.sh`. Credenciais continuam no `worker.env`; nada sensível entra neste arquivo.

Bloco para o **dry-run** (fase 1, não contata o Sankhya):

```
services:
  worker:
    environment:
      SANKHYA_ORDER_WRITE_ENABLED: "true"
      SANKHYA_ORDER_WRITE_MODE: dry_run
      SANKHYA_ORDER_ORIGIN_FIELD: AD_FORCEORIGEM
  api:
    environment:
      ERP_ORDER_ENQUEUE_ENABLED: "true"
```

Bloco para o **live** (fase 2; só depois do "AUTORIZO" escrito; substitui o bloco acima):

```
services:
  worker:
    environment:
      SANKHYA_ORDER_WRITE_ENABLED: "true"
      SANKHYA_ORDER_WRITE_MODE: live
      SANKHYA_ORDER_WRITE_GATES_CLOSED: "1"
      SANKHYA_ORDER_ORIGIN_FIELD: AD_FORCEORIGEM
      SANKHYA_MODE: live
      SANKHYA_ENVIRONMENT: sandbox
      SANKHYA_BASE_URL: <um dos dois hosts do Sandbox>
  api:
    environment:
      ERP_ORDER_ENQUEUE_ENABLED: "true"
```

Aplicar (recria só api e worker):

```
deploy/scripts/sf-compose.sh -f /opt/force-staging/config/compose.write-sandbox.yml up -d --no-deps --force-recreate api worker
```

**Qualquer deploy ou recriação sem esse `-f` desliga tudo** (os padrões distribuídos têm a escrita desligada): o `deploy-staging.sh`, o `rollback-staging.sh` e um `sf-compose.sh` sem o `-f` voltam ao estado desligado. Para religar, repetir o comando acima. Para desligar de propósito, recriar api e worker sem o `-f`.

Do lado da API, o enfileiramento (`ERP_ORDER_ENQUEUE_ENABLED=true`) só é aceito com `SF_DEPLOY_ENVIRONMENT=staging`. Todos os padrões distribuídos (compose de desenvolvimento e staging) mantêm os dois desligados; um teste automatizado falha se algum arquivo de deploy habilitar a escrita.

Antes de ligar: o worker recusa iniciar com a escrita ligada fora do staging e em modo `live` fora do Sandbox, sem a marca de comportas fechadas ou sem o campo de origem. Para voltar: remover as variáveis (ou `SANKHYA_ORDER_WRITE_ENABLED=false`); o agendamento é retirado na próxima partida do worker.
