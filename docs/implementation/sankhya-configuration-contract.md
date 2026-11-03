# Configuração lida do Sankhya — contrato PONTE / BASE / INFRA

> **Status:** PONTE, BASE e INFRA descrevem o que o código já faz (CFG-8, `docs/decisions.md` §3.17, decisões de 2026-11-03). A camada `AD_PLACFORCE*` (seção 5) é **PROPOSTA** (U-10-b: adiada) e **não autoriza criar nada em nenhum ambiente Sankhya**. Este documento não contém DDL. Criar tabelas ou telas no Sankhya segue um fluxo próprio aprovado, Sandbox primeiro (SNK-3).

## 1. Princípio

O que a PLAC já configura no Sankhya, o Force **lê** (PONTE). O que é só do Force fica no **arquivo base** (BASE). O que é segredo ou infraestrutura nunca entra no ERP (INFRA; P-22, SEC-1). O Force nunca escreve configuração no Sankhya (P-02/P-03).

O worker (job `sync.configuration`, a cada 15 min e no start, só com `CONFIG_SYNC_FROM_SANKHYA=1`; padrão `0`) lê as consultas Q1–Q8 pelo `SankhyaGateway.readConfigurationFacts()`, sobrepõe a PONTE ao último arquivo base (`bootstrap-file`) e grava uma nova versão `source.kind='sankhya'` em `installation_configuration_version`, com `source.base` (versão do arquivo) e **proveniência por chave** (`TABELA.COLUNA` e hora da leitura). A API e o domínio usam só o snapshot local, nunca o Sankhya, nos caminhos de requisição.

Regras do mecanismo:

- **Falha fecha:** leitura falha ou parcial (qualquer Q com erro) = nenhuma versão nova; a vigente continua; a falha aparece em `sync_state` (`entity='configuration'`) e no painel de integração.
- **Sem alteração = sem versão:** o hash do conteúdo ignora `readAt` e `syncedAt`; conteúdo igual é no-op.
- **Auditoria:** cada versão nova registra as chaves alteradas e as mudanças de escopo (códigos de TOP/negociação acrescentados ou removidos).
- **Gatilho de versão vigente:** a migração 0019 impede que uma versão armazenada volte a `is_current`.
- **Visibilidade (CFG-7):** vendedor recebe só a fatia segura; `GET /api/v1/configuration` (com proveniência) é só de administrador e técnico. A tela W-38 é somente leitura.

## 2. PONTE — chaves lidas do Sankhya

| Chave do Force | Origem (tabela.coluna) | Consulta |
|---|---|---|
| `general.enabledCompanyCodes` | `TSIEMP.AD_MOBILIDADE` = S | Q2 |
| `general.defaultCompanyCode` | `TSIEMP.AD_MOBILIDADE` (primeira empresa habilitada) | Q2 |
| `sales.orderTopCode` | `TSIEMP.AD_CODTIPOPERPAD` | Q2 |
| `sales.eligibleOrderTopCodes` | `TGFTOP.AD_MOBILIDADE` = S (última versão, `TIPMOV` = P), limitada por `sales.topAllowlist` quando existir | Q3 |
| `sales.quoteTopCodes` | `AD_TVDYGRUOP.NOME` ("ORÇAMENTO") + `AD_TVDYTOPGRU.CODTIPOPER` | Q4 |
| `sales.quotationTopCode` | idem, só quando há exatamente uma TOP de orçamento | Q4 |
| `sales.skipConfirmationTopCodes` | `TGFTOP.AD_PULARCONFIRMACAO` = S (vazio em todas as TOPs ⇒ mantém o valor base e avisa `skip_confirmation_not_read`) | Q3 |
| `sales.negotiationTypes` | `TGFTPV.AD_MOBILIDADE` = S e `ATIVO` = S (versão vigente), menos `sales.negotiationTypeExclusions` | Q5 |
| `sales.orderStockLocationCode` | `AD_TVDYCFGFRC.CODLOCALPEDIDOS` | Q1 |
| `sales.orderBehavior.decimalQuantities` | `AD_TVDYCFGFRC.USADECQTD` | Q1 |
| `customers.historyDays` | `AD_TVDYCFGFRC.DIASCONSULTAVENDAS` | Q1 |
| `customers.purchasedWindowDays` | `AD_TVDYCFGFRC.QTDDIASPRODCOMPRADOS` | Q1 |
| `pricing.catalogReferenceTableCode` | `AD_TVDYCFGFRC.TABPADCSLTPROD` | Q1 |
| `pricing.alternativeTable.tableCode` | `AD_TVDYCFGFRC.CODTABALT` (registrada, inativa) | Q1 |
| `pricing.mobilePriceTableCodes` | `TGFNTA.AD_MOBILIDADE` = S | Q6 |
| `erp.orderStatusDisplay` | `AD_TVDYFRCSTS` (código, nome, cor) | Q7 |

**Leituras só informativas** (vão para o relatório da sincronização, não alteram o snapshot): Q8 (distribuição de `TGFPRO.AD_MOBILIDADE`, não decide nada hoje), `AD_TVDYCFGFRC.UTILFINANC`, `AD_TVDYCFGFRC.OCLTLIMCRED` (decisão do dono de 2026-11-03: `showCreditLimit` continua do arquivo base) e parâmetros sem funcionalidade no Force.

## 3. BASE — chaves só do Force (arquivo base)

Arquivo JSON fora do repositório, validado por `InstallationConfigurationSchema` e pelas regras de consistência do domínio, aplicado por `config-bootstrap`. Vale para tudo o que não tem origem no Sankhya, e como valor de reserva da PONTE:

- `general.appMinimumVersion`
- `sales.topAllowlist` (TOPs do piloto: mecanismo de escopo; ausente = todas as habilitadas no Sankhya)
- `sales.negotiationTypeExclusions` (hoje 23 e 24)
- `sales.discountAuthority.mode` e demais políticas de desconto
- `pricing.fallbackTableCode`, política de produto/cliente sem preço (CFG-4/CFG-5)
- `customers.creditFeatures.showCreditLimit`
- vínculos conta → vendedor, flags de recursos
- `erp.liberationEventLabels` (nome dos eventos de liberação; ausente ⇒ a tela mostra "evento N")

Os valores comerciais da instalação são configuração, nunca literais no código (CFG-3, CFG-6).

## 4. INFRA — nunca no ERP nem no snapshot

Hosts, credenciais, `VERIFIER_*`, `SANKHYA_ORDER_WRITE_*`, `SANKHYA_ORDER_ORIGIN_FIELD`, chaves e segredos ficam em `compose.env` e nos arquivos de segredos da instalação (STACK-2, SEC-1). Nenhuma consulta Q1–Q8 lê coluna de credencial (há teste).

## 5. PROPOSTA — tabelas próprias `AD_PLACFORCE*` (próxima etapa, U-10-b: ADIADA)

Quando o primeiro sync estiver rodando, o que hoje é BASE e é "do negócio" pode ganhar tabelas do Force dentro do Sankhya, criadas pelo dono no Dicionário de Dados. Campos propostos (sem tipos nem DDL):

- `AD_PLACFORCECFG` (1 linha): `NUCFG`, `VERSAOMINIMAAPP`, `DIASOFFLINEMAX` (7), `MODOALCADA` (ERP/FORCE, padrão ERP), `PERMITEPDF` (S), `PERMITEIMPORTPLAN` (S), `DHALT`, `CODUSUALT`.
- `AD_PLACFORCETOP` (filha): `CODTIPOPER`, `PERMITIDA`, `PADRAO` — substituiria `sales.topAllowlist`.
- `AD_PLACFORCETPV` (filha): `CODTIPVENDA`, `PERMITIDA` — substituiria `sales.negotiationTypeExclusions`.

Só entra o que não existe no Vidya e não é segredo. Se o Vidya for desligado, as tabelas `AD_TVDY*` continuam no banco da PLAC; migrar o que for usado para `AD_PLACFORCE*` seria um script, não uma decisão de agora.

## 6. Pontos em aberto

- Criar `AD_PLACFORCE*` (U-10-b) e quando.
- Fonte definitiva do arquivo base antes disso (U-11).
- Configuração por empresa em clientes multiempresa.
- O campo de origem de pedidos (SNK-5, U-12) não faz parte deste contrato.
- Q8 e leituras informativas só existem no relatório do worker; não há API para elas (a W-38 avisa isso).
