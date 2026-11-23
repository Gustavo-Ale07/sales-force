# Roteiro de teste de escrita de cliente no Sandbox (T1–T9) — para autorização do dono

Status: **NÃO EXECUTADO.** Nenhuma escrita no Sandbox, nenhum contato com o Sankhya foi feito. Este roteiro só vale após autorização explícita do dono (SNK-6, SNK-4, D-AR). Complementa `docs/implementation/customer-write-plan.md` §6.

## 1. O que existe no código

- Adaptador real em `packages/sankhya/src/real/real-gateway.ts`: `upsertPartner`, `findPartnerByOrigin`, `findPartnerByDocument`, `readWrittenPartner`. Fechado por padrão: sem `SANKHYA_CUSTOMER_WRITE_ENABLED` válido, toda operação recusa com `NotImplementedError` (permanente) sem nenhuma chamada HTTP.
- Abre somente com: `SF_DEPLOY_ENVIRONMENT=staging`, `SANKHYA_MODE=live`, `SANKHYA_ENVIRONMENT=sandbox`, host na lista `SANKHYA_ALLOWED_HOSTS` e do Sandbox, `SANKHYA_CUSTOMER_ORIGIN_FIELD` (campo dedicado, ex.: `AD_FORCEORIGEM`; nunca `AD_VDYORIG`/`AD_NUVIDYA`) e `SANKHYA_CUSTOMER_WRITE_ENABLED=true` (`customer-write-config.ts`).
- **Todo o formato de fio não validado está em um único módulo: `packages/sankhya/src/write/partner-wire.ts`.** O spike corrige apenas esse arquivo.
- A ordem do worker (D-AR) é: buscar por origem, buscar por documento, escrever, reler.
- `LIMCRED` nunca é enviado (teste automatizado garante). Colunas proibidas: LIMCRED, LIMCREDMENSAL, SENHABT, SENHAACESSO, CODTIPPARC, CODREG, TIPOGERBOLETO, CODPARC, campos Vidya.
- Limites de coluna validados antes do envio, sem truncar; o erro nomeia o campo.

## 2. NEEDS VALIDATION (não inventado; confirmar neste roteiro)

1. Serviço de escrita: `CRUDServiceProvider.saveRecord`, entidade `Parceiro` (origem: documentação, não validado).
2. Formato da requisição (`dataSet.dataRow.localFields`) e da resposta (`responseBody.entities.entity.CODPARC.$`).
3. Nomes das colunas de observação, telefone, e-mail, complemento e número do endereço (`OBSERVACOES`, `TELEFONE`, `EMAIL`, `NUMEND`, `COMPLEMENTO`): relatório S5.
4. Tamanhos de `RAZAOSOCIAL`, `TELEFONE`, `EMAIL`, `OBSERVACOES`, `NUMEND`, `COMPLEMENTO` (hoje sem checagem local); `IDENTINSCESTAD` 16 é regra do dono (2026-11-13), não tamanho medido.
5. Contatos e endereços adicionais: mapeamento inexistente; edição de contatos/endereços recusada. Mais de um endereço na criação é recusado.
6. Edição (D-AP): `buildPartnerEditRequestText` existe (só telefone, e-mail, observações), mas **não está ligada ao gateway nem à porta**; precisa de mudança de porta aprovada.
7. Texto exato de recusa do ERP para CNPJ duplicado e campo obrigatório (classificação hoje por padrões de texto).
8. Valor aceito de `CLASSIFICMS` (C/I/P/R/T/X) e de `IDENTINSCESTAD = 'ISENTO'`.
9. Preenchimento automático por trigger/default de CODTIPPARC, CODREG, TIPOGERBOLETO (esperado 0, 0, 'I').
10. Se o Sandbox aceita CNPJ com 14 dígitos iniciado por zero sem perder o zero.

## 3. Convenções

- Nome sempre `TESTE FORCE - NAO USAR <rótulo>`; máximo 10 clientes; CNPJ/CPF sintéticos válidos (dígitos verificadores corretos), nunca reais.
- Anotar cada CODPARC criado em `docs/sankhya-spike.md` (S5). Nada é apagado por este roteiro.
- Somente SELECTs de leitura. Ver nomes de coluna contra o relatório S5 antes.

Consulta base (substituir `:origem` ou `:doc`):

```sql
SELECT CODPARC, NOMEPARC, TIPPESSOA, CGC_CPF, CLIENTE, ATIVO, BLOQUEAR,
       CODVEND, CODTAB, LIMCRED, AD_FORCEORIGEM
FROM TGFPAR
WHERE AD_FORCEORIGEM = :origem   -- ou: CGC_CPF = :doc
```

Consulta de defaults herdados:

```sql
SELECT CODPARC, CODTIPPARC, CODREG, TIPOGERBOLETO, CLASSIFICMS, IDENTINSCESTAD
FROM TGFPAR WHERE AD_FORCEORIGEM = :origem
```

## 4. Passos

| T | Ação | Esperado | SELECT (somente leitura) |
|---|---|---|---|
| T1 | Criar PJ de teste com IE e vendedor; CNPJ sintético válido | Cadastrado só após releitura; CODPARC real | Consulta base por `:origem`: 1 linha. Confere ATIVO='S', CLIENTE='S', BLOQUEAR='N', CODTAB=5 |
| T1b | Criar PJ com CNPJ que começa em zero | Gravado e relido com 14 dígitos (item 10) | `SELECT CGC_CPF FROM TGFPAR WHERE CODPARC = :codparc` |
| T1c | Criar PF (CPF sintético, sem IE) | Cadastrado; sem IE | Consulta base |
| T2 | Criar outro cliente com o mesmo CNPJ (origem nova) | Recusa antes de escrever (busca por documento acha o existente); sem segundo cadastro | `SELECT COUNT(*) FROM TGFPAR WHERE CGC_CPF = :doc` = 1 |
| T3 | Repetir o mesmo envio (mesma chave de origem) | Mesmo CODPARC devolvido, nenhuma escrita nova | `SELECT COUNT(*) FROM TGFPAR WHERE AD_FORCEORIGEM = :origem` = 1 |
| T4 | Criar sem sinal, depois sincronizar | "Aguardando envio", depois confirmado com CODPARC | Consulta base: 0 linhas antes, 1 depois |
| T5 | Editar telefone e e-mail | Só se a porta de edição for aprovada (item 6); caso contrário **pular** | Colunas de contato (nomes: S5) |
| T6 | Enviar campo bloqueado (razão social, CNPJ, limite) | Recusa no servidor antes de qualquer chamada; nada muda | Consulta base inalterada |
| T7 | Vendedor tenta editar cliente de outro | 403/404 sem revelar dados | Consulta base inalterada |
| T8 | Regras de nascimento | ATIVO='S', CODVEND do vendedor, CODTAB=5, **LIMCRED nulo**, BLOQUEAR='N', CLIENTE='S'; CODTIPPARC/CODREG/TIPOGERBOLETO em 0/0/'I' | Consultas base e de defaults |
| T9 | Abrir o novo cliente no app e no site | Mesmo CODPARC e dados | Consulta base × tela |

Casos de falha a provocar uma vez (anotar resposta bruta mascarada em `.sankhya-raw/`, nunca no Git): CNPJ duplicado direto no ERP (texto de recusa, item 7); IE ausente em PJ; nome com mais de 100 caracteres (deve recusar localmente, sem chamada).

## 5. Critério de parada

Qualquer resposta diferente da esperada, escrita duplicada, LIMCRED preenchido ou default diferente de 0/0/'I': parar, não repetir, registrar em `docs/sankhya-spike.md` e voltar ao dono. Nenhum retry de recusa permanente.
