# Cadastro e edição de cliente pelo Force — gravação imediata no Sankhya (plano)

**Status: PLANO (working note, não é decisão).** Origem: texto do dono de 12/11/2026 (complemento "escrita imediata" + bloco "Cadastro e edição de cliente"). Estende D-AP (PROPOSED) e D-AQ. Nada aqui libera gravação: a flag nasce FECHADA e o AUTORIZO do dono cobre apenas o Sandbox, até 10 clientes `TESTE FORCE - NAO USAR`, sem produção, sem exclusão (registrar cada CODPARC em docs).

## 0. Bloqueios que impedem a fatia de mapeamento (parar e perguntar)

| # | Falta | Efeito | Quem resolve |
|---|---|---|---|
| B1 | Relatório S5 do agente do Chrome: campos obrigatórios do parceiro, estrutura de endereço codificado (cidade/bairro/logradouro), exigência de IE por classificação ICMS (C, I, P, R, T, X) | Sem ele não se escreve o mapeador `Partner → serviço Sankhya` nem o formulário de endereço | Dono / agente do Chrome |
| B2 | Nome da coluna de mobilidade em `TGFPAR` (D-AQ NEEDS VALIDATION) | O mapeador não pode gravar a mobilidade; nunca chutar | Dono |
| B3 | Criação de `TGFPAR.AD_FORCEORIGEM` no Sandbox (tipo/tamanho comporta `force:<uuid>` = 42 caracteres?) | Idempotência e checagem prévia | Agente do Chrome |
| B4 | Decisão arquitetural A1 abaixo (sync via worker) | Define a forma da API | Dono |
| B5 | D-AP continua PROPOSED; este bloco altera P-18 (aprovação do backoffice) para o cadastro feito pelo vendedor | Registrar como decisão D-AR quando o dono aprovar | Dono |

As fatias **sem** B1/B2/B3 podem começar já (seção 3, F1–F6), sempre com o duplo do Sankhya.

## 1. Arquitetura proposta

**A1 — Gravação "síncrona" sem credencial no processo da API (STACK-2/2a, P-02/P-03).** A API não guarda credencial de escrita do Sankhya; só o worker guarda. Proposta: a API grava o comando em `integration_outbox` (tipo `customer.upsert`, chave de idempotência = `clientRequestId`) e **aguarda o desfecho** (poll curto, ~10–15 s, o mesmo padrão do diálogo de envio do site). O worker executa imediatamente: (1) SELECT por `AD_FORCEORIGEM` (se achou, devolve o mesmo cliente); (2) SELECT por CPF/CNPJ (duplicidade); (3) grava pelo serviço padrão; (4) **relê** por SELECT; (5) atualiza o espelho do servidor na mesma transação com o que o Sankhya guardou; (6) marca o comando `confirmed`. A API responde "cadastrado" só então. Estouro do prazo ⇒ resposta "em processamento" (HTTP 202) e o cliente fica **aguardando envio**; o mesmo worker conclui depois, sem duplicar (mesma chave). Alternativas: (B) API com credencial de escrita — exigiria emendar STACK-2 (rejeitada por mim); (C) só assíncrono — não atende "responde só depois da releitura".

**A2 — Sem sinal.** O app cria o cliente **local** `aguardando_envio_sankhya` (id local UUIDv7 + `clientRequestId`), enfileirado no outbox do aparelho; reenvio usa a mesma chave. Cliente nessa situação **não pode receber pedido** (guarda no assistente do pedido e no envio; texto: "Este cliente ainda não foi confirmado pelo Sankhya."). Ao confirmar, o cliente real (CODPARC) **substitui** o pendente no aparelho (reaponta rascunhos que o referenciavam).

**A3 — Espelho.** Atualizado só pelo resultado da releitura. Falha no meio ⇒ nada no espelho (transação única; o comando fica `rejected`/`unknown` com motivo; sem registro parcial).

**A4 — Domínio (`packages/domain`).** Validação de CPF/CNPJ (dígitos), classificação ICMS e regra "exige IE" (valores vindos de S5, nunca literais), máscara. Sem nomes de tabela/coluna ERP (check-boundaries).

**A5 — Pedidos.** Fluxo de envio atual inalterado. Única mudança no plano: o pedido só aceita cliente **confirmado** (com CODPARC); o pedido não passa a "reler" nada novo. A releitura pós-gravação já é o princípio do espelho de pedidos? — **a confirmar** (não verificado neste plano; ver D-4 do plano SNK-7).

## 2. Regras fixas (do texto do dono)

- Nasce `CLIENTE='S'`, `ATIVO='S'`, mobilidade `'S'` (coluna: B2), `BLOQUEAR='N'`, tabela padrão **5 por configuração da instalação** (CFG, não literal), `CODVEND` = vendedor da conta; Gerente/Admin escolhem o vendedor entre os que alcançam (escopo servidor). `LIMCRED` **nunca** gravado; tela: "Limite de crédito a definir pelo financeiro".
- Vendedor não vê nem edita ativo, mobilidade, limite, tabela, situação financeira nem vendedor.
- Duplicidade ao vivo por CPF/CNPJ: na carteira do vendedor → "Cliente já cadastrado na sua carteira" (abre a ficha); fora → "Este CPF/CNPJ já está cadastrado. Peça ao backoffice." Sem nome/dado de outro vendedor (R17, resposta idêntica para qualquer fora-de-escopo).
- Edição: só telefone, e-mail, contatos, endereços, observações. Servidor rejeita qualquer outro campo (lista **permitida**, não negada). Lê o registro ao vivo, aplica só o diff; se mudou no Sankhya desde a última sincronização, devolve o valor atual e exige confirmação. Auditoria com valor antigo/novo, documentos mascarados.
- Permissões novas `customers.create`, `customers.update` (deny-by-default; sem conceder a perfil algum sem instrução do dono — **pergunta D1**), limite de criações por usuário/hora, nada de documento/e-mail/telefone em log, migrações aditivas.
- Transportadora obrigatória no pedido: **só confirmar com teste** (app, site, servidor); não alterar.
- Consulta pública de CNPJ: atrás de flag, desligada por padrão (fatia opcional F10).

## 3. Fatias (um commit por fatia; TDD nas áreas obrigatórias)

| Fatia | Conteúdo | Depende |
|---|---|---|
| F0 | Teste que fixa "transportadora obrigatória" (app, site, servidor) | — |
| F1 | Domínio: CPF/CNPJ, máscara, tipo de pessoa; regra de IE/ICMS como tabela configurável | — (valores de IE: B1) |
| F2 | Flag `SANKHYA_CUSTOMER_WRITE_ENABLED` (padrão fechada, só o worker lê, mesmas validações de boot da flag de pedido: allowlist Sandbox, recusa em staging/produção sem decisão) + `describe()` | — |
| F3 | Contrato do gateway `upsertPartner/findPartnerByOrigin/findPartnerByDocument` + `FakeGateway` (sucesso, duplicado, validação, indisponível, resposta ambígua, falha no meio) | — (campos: B1) |
| F4 | Migração aditiva: permissões, colunas de origem/estado no espelho e no comando; `integration_outbox` tipo `customer.upsert` | F3 |
| F5 | API: `POST /customers` (clientRequestId, espera pelo desfecho, 200/202/409/422), `PATCH /customers/:id`, matriz de testes por perfil (vendedor, gerente, admin, sem vendedor), limite/hora, campos bloqueados rejeitados, escopo por carteira | F2–F4 |
| F6 | Worker: consumidor `customer.upsert` (origem → documento → grava → relê → espelho em transação), classificação de erros (permanente não reenvia), auditoria | F3–F5 |
| F7 | Mobile: cliente local pendente, fila, substituição por CODPARC, bloqueio de pedido, listagem imediata | F5 |
| F8 | Mobile: formulário em etapas (Documento → Dados → Endereço → Contato/obs → Resumo), testado em 360x640 e 412x915 | B1 (endereço) |
| F9 | Mobile+API: edição (Editar na ficha) com confirmação de conflito | F5–F7 |
| F10 | (Opcional) consulta de CNPJ por API pública atrás de flag | — |

Endereço: se o logradouro/bairro codificado for obrigatório e não houver forma de o vendedor escolher, **parar na F8** e propor a saída no relatório (não inventar).

## 4. Critérios de aceite (todos com o duplo do Sankhya)

Validação CPF/CNPJ · duplicidade (carteira × fora) · repetição idempotente · falha no meio ⇒ sem registro parcial no espelho · escopo por perfil · offline + reenvio com a mesma chave · pedido bloqueado para cliente pendente · campo bloqueado rejeitado · nenhum dado pessoal em log · typecheck, lint e testes (domain, mobile, web, servidor) com saída real.

## 5. Como o dono liga a flag em staging (sem o agente tocar)

Descrito, nunca executado por mim: o dono define `SANKHYA_CUSTOMER_WRITE_ENABLED` e o modo Sandbox no ambiente do **worker** do staging pelo procedimento dele (`compose.env*`/`enable-*` fora do Git), confere a página de saúde da integração ("escrita de cliente: ligada-Sandbox") e executa o roteiro abaixo. Fechar a flag restaura o estado seguro sem outra mudança. Enquanto a decisão "flag em staging" (hoje recusada no boot pela regra do plano SNK-7) não for emendada pelo dono, F2 precisa de uma regra explícita para staging-Sandbox: **pergunta D2**.

## 6. Roteiro Sandbox para o dono (T1–T9) e SELECTs para o agente do Chrome

Convenções: nome sempre `TESTE FORCE - NAO USAR …`; máximo 10 clientes; anotar cada CODPARC em `docs/sankhya-spike.md` (seção S5). Nomes de coluna abaixo são os do espelho conhecido; **conferir contra o relatório S5** antes de executar; `<COLUNA_MOBILIDADE>` = B2.

Consulta base (substituir `:origem`/`:doc`):

```sql
SELECT CODPARC, NOMEPARC, TIPPESSOA, CGC_CPF, CLIENTE, ATIVO, <COLUNA_MOBILIDADE>, BLOQUEAR,
       CODVEND, CODTAB, LIMCRED, AD_FORCEORIGEM
FROM TGFPAR
WHERE AD_FORCEORIGEM = :origem   -- ou: CGC_CPF = :doc
```

| T | Ação (no app/site em staging) | Esperado | Conferir no Sankhya |
|---|---|---|---|
| T1 | Criar PJ de teste com conexão | "Cadastrado" só após releitura; CODPARC real na ficha | Consulta base por `AD_FORCEORIGEM = 'force:<uuid>'`: 1 linha |
| T2 | Criar outro cliente com o mesmo CNPJ | Recusa: carteira → "já cadastrado na sua carteira"; fora → "Peça ao backoffice" | `SELECT COUNT(*) FROM TGFPAR WHERE CGC_CPF = :doc` = 1 |
| T3 | Repetir o mesmo envio (mesma chave) | Mesmo cliente devolvido, sem novo cadastro | `COUNT(*) WHERE AD_FORCEORIGEM = :origem` = 1 |
| T4 | Criar sem sinal, depois sincronizar | "Aguardando envio" → confirmado com CODPARC; pedido bloqueado enquanto pendente | Consulta base: 1 linha após sincronizar, 0 antes |
| T5 | Editar telefone e e-mail | Valores novos no Sankhya, auditoria com antigo/novo | Consulta dos campos de contato do parceiro (nomes: S5) |
| T6 | Enviar campo bloqueado (ex.: razão social) | Servidor recusa; nada muda | Consulta base inalterada |
| T7 | Vendedor tenta editar cliente de outro | 403/404 sem revelar dados | Consulta base inalterada |
| T8 | Conferir regras de nascimento | ATIVO='S', mobilidade 'S', CODVEND do vendedor, CODTAB=5, **LIMCRED nulo/não gravado**, BLOQUEAR='N', CLIENTE='S' | Consulta base |
| T9 | Abrir o cliente novo no app e no site | Mesmo CODPARC, mesmos dados, sem esperar a sincronização completa | Consulta base × tela |

## 7. Perguntas ao dono

- **D1** Quais perfis recebem `customers.create`/`customers.update` na instalação PLAC (sugestão: vendedor interno e gerente/admin; representante externo — a decidir)? Sem resposta, ninguém recebe.
- **D2** Regra de boot da flag de cliente em staging: permitir `true` em staging **somente** com host Sandbox na allowlist e modo explícito `sandbox`?
- **A1** Aprova a gravação via worker com espera (poll ~10–15 s, 202 se estourar) em vez de credencial de escrita na API?
- **B1/B2/B3** Relatório S5, nome da coluna de mobilidade e criação de `AD_FORCEORIGEM`.
