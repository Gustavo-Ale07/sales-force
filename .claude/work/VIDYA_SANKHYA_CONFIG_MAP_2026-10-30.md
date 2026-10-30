# Como o Vidya Force é configurado dentro do Sankhya — e proposta para o Plac Force (U-10)

Fontes: catálogo Oracle (ALL_TABLES/ALL_TAB_COLUMNS/ALL_CONSTRAINTS/ALL_OBJECTS), dicionário do Sankhya (TDDTAB/TDDCAM/TDDOPC/TDDINS), a linha de `AD_TVDYCFGFRC`, fonte das 9 funções e 7 views `*_VIDYA`, amostra do `AD_TVDYLOGPED` — lidos em 30/10/2026 pelo dono, somente leitura. **Ambiente: os quatro exports das 10h29 (dicionário, parâmetros, fontes e log) vieram do Sankhya de PRODUÇÃO — o log traz envios de hoje entre 07h15 e 10h27 com nº único 20.155–20.696, e o Sandbox está na casa dos 2.400; o catálogo das 10h23 veio do Sandbox. Leitura apenas, sem efeito; mas o Sandbox pode estar defasado em relação à produção, e é o Sandbox que o staging lê.** Nada aqui contém credencial; os exports brutos (em especial o do log, que traz nomes de clientes) ficam fora do repositório.

Legenda: **PONTE** = o Force lê a mesma configuração que o Vidya, sem recadastrar · **PRÓPRIA** = precisa de objeto novo do Force no Sankhya · **INFRA** = nunca vai para o banco do ERP · **IGNORAR** = recurso que a PLAC não usa.

---

## 1. O modelo do Vidya (como a Vidya resolveu "configuração dentro do Sankhya")

| Camada | Onde | O que é | Mantido por |
|---|---|---|---|
| Parâmetros gerais | `AD_TVDYCFGFRC` (1 linha, `NUCFG`=1, **370 colunas**, 88 preenchidas) | Cada coluna é um parâmetro: bloqueios (`BLOQ*`), permissões (`PERM*`), exibir/ocultar (`EXIB*`/`OCULT*`), validações (`VALID*`), prazos (`DIAS*`, `TEMP*`), códigos padrão (`CODLOCALPEDIDOS`, `NULAYOUT`, `CODTABALT`, `TABPADCSLTPROD`), versão mínima do app | Tela "Configurações Vidya Code" (instância 9999990116 do Construtor) |
| Tabelas filhas por `NUCFG` | `AD_TVDYFRCSTS` (8 status com cor e permissões), `AD_TVDYGRUOP`/`AD_TVDYTOPGRU` (grupos de TOP: NOTA=1101, ORÇAMENTO=1000, PEDIDO DE VENDA=1001+2209), `AD_TVDYRFE` (2 relatórios), `AD_TVDYLYTTOP`, `AD_TVDYMOBTOP`, `AD_TVDYCAMPAR/CAMPRO` (campos extras nas telas), `AD_TVDYUSUMASTER`, `AD_TVDYPRODEST` | Listas de configuração | Telas próprias (uma por tabela, 56 instâncias no Construtor) |
| Flags em tabelas padrão | `AD_MOBILIDADE` em TGFTOP, TGFTPV, TGFNTA, TGFPRO, TGFLOC, TSIEMP; `TSIEMP.AD_CODTIPOPERPAD`; `TGFTOP.AD_PULARCONFIRMACAO`, `AD_PERMITEFATURARAPP`, `AD_*PERFORMANCE`; `TGFPAR.AD_VIDYA/AD_PROSPECT/AD_ANALISE`; `TGFVEN.AD_CODGRUVEN`; `TGFVOA/TGFVOL.AD_BLOQVDY` | "Este registro aparece no app?" decidido no próprio cadastro do Sankhya | Cadastros normais do Sankhya (TOP, tipo de negociação, tabela, produto, empresa) |
| Parâmetros do Sankhya | `TSIPAR`: `TIPTABPRECOS`=4 (tabela por parceiro), `USARCODTABEMP`=N, `PASSBDMOB`, `MASC_TVDYFRCGRU` | Regras nativas que o Vidya respeita | Preferências do Sankhya |
| Regras em código no banco | Funções `GETCODTAB/GETNUTAB/GETPRECOTAB/GETPRECO/GETNUPROMOCAO/GETCODSTATUS/GETSTATUS_VIDYA`; views `VGFPAR/VGFCAB/VGFFIN/VGFEST/VGFSTATUS/VSIRFE/VTSIAVI_VIDYA` | Preço, status, carteira, financeiro, estoque | Vidya (versão 2.0, 2023) |
| Metas e performance | `AD_TVDYCFGPFM` (56 períodos), `AD_TVDYDRTIPT` (66 diretrizes/metas/pesos), `AD_TVDYPFMTOP` (8 TOPs contadas), `AD_TVDYVEN` (194 vínculos vendedor×período), `AD_TVDYPFMPRO` (0) | Cadastro de metas | Telas "Configuração de Performance" |
| Rastro do que o app enviou | `AD_TVDYLOGPED` (~5.000 linhas, só método `sendOrdersOffline`, 4.725 ok / 314 erro) | Payload (base64 JSON) e resultado de cada envio | Automático |
| Carimbos no documento | `TGFCAB.AD_NUVIDYA` (id do app), `AD_VDYORIG`, `AD_DHCRIACAOVDY`, `AD_DHCONFIRMVDY`, `AD_STATUS` (P/E/A/L), `AD_OFFLINE`, `AD_EXPEDICAO` (S/N), `AD_ENTREGUE`, `AD_NUMLAT/LONG`; `TGFITE.AD_VLRUNITIPI/AD_VLRTOTIPI` | Origem e estado do pedido vindo do app | Automático |
| Não usados pela PLAC (tabelas vazias) | Agenda (`FRCAGD*`), link de pagamento/PIX (`CABLINK/CABPIX/CFGLINK/CFGPIX`), registro de entrega (`REGENT`), assinatura (`CONTASS`), anexos (`ANXARQ/ANXCLT`), produtos por perfil, destaque, faixas de rentabilidade, grupos de vendedores (`FRCGRUVEN`=0), as 5 `AD_VVDYMOB*` | — | IGNORAR |

Observação: `TSIUSU.AD_OPSUPERVISOR` é "Supervisor de **Produção**" (1 usuário, sem vendedor) — não tem relação com gerente comercial. O gerente de um vendedor é `TGFVEN.CODGER` (ex.: vendedor 11 → gerente 83).

---

## 2. Valores em uso na PLAC (os que importam para o Force)

| Parâmetro | Valor | Significado | Para o Force |
|---|---|---|---|
| `TIPDESC` | P | Desconto em percentual | PONTE — já é assim (DISC-1) |
| `PERMITEDESCNOAPP` | S | Vendedor dá desconto no app | PONTE |
| `VALDESCMAX` | **A = Validar e Avisar** | O "desconto máximo 12%" só avisa; opções: N, A, S=bloquear | Explica o F-02 da auditoria: é configuração, não bug. No Force, modo `erp` (D-M): sem bloqueio local; o aviso pode ser reproduzido quando a fonte do limite por produto for identificada (D-H) |
| `VALVLRMIN` | A | Valor mínimo: avisa | idem |
| `APLICADESCTOT` / `APLICDESCMSS` | S / S | Desconto no total e em massa | Massa: PONTE (já existe). Total: D-F = NÃO no Force |
| `ALTTIPNEG` | S | Vendedor escolhe o tipo de negociação | PONTE (P3a) |
| `PERMALTPRECOPROD` | N | Não altera preço | PONTE — regra do produto |
| `USADECQTD` / `DECVLR` | S / 2 | Quantidade decimal; valor com 2 casas | PONTE (P4) |
| `CODLOCALPEDIDOS` | 209 | Local padrão do pedido (EXPEDIÇÃO) | PONTE (D-8) |
| `TABPADCSLTPROD` / `CODTABALT` | 5 / 5 | Tabela do catálogo e alternativa | PONTE (catálogo mobile usa a 5 como referência) |
| `NULAYOUT` | 30 | Layout do cabeçalho | IGNORAR (layout é do Sankhya) |
| `DIASCONSULTAVENDAS` / `QTDDIASPRODCOMPRADOS` | 90 / 90 | Janela do histórico e de "comprados" | PONTE (Fase B) |
| `UTILFINANC` | S | Mostra financeiro | PONTE (P6) |
| `BLOQVENDPPRAZO`, `BLOQVENDCLIINAD`, `BLOQVENDCLIBLOQ`, `DIASPARAATRASO`, `EXIBLIMCRECAR`, `OCLTLIMCRED` | vazios | Nenhum bloqueio por crédito configurado | Confirma D-I: financeiro só leitura; nenhuma trava a copiar |
| `HABIIMPPLAN` / `SCANPRODIA` / `LIBIMPORTIAVOZ` | S / S / S | Importação de planilha e por IA | Planilha: PONTE (IMP-1). IA: Fase 3 |
| `UTILCOMISSAO` / `PERMPERF` | S / S | Comissão e performance ligados | Fase B (metas nas tabelas PFM) |
| `VERSAOMINIMA` / `VERMIN` | 5.2.099 / S | Versão mínima do app Vidya | PRÓPRIA (versão mínima do app Force) |
| `TEMPODADOSOFFLINE` | vazio | Dias de dados offline | PRÓPRIA (RF-IAM-8: 7 dias) |
| `INSERIRLOG` | S | Grava o log de pedidos | PONTE em espírito: o Force tem o `integration_outbox` |
| `HOSTAPIVIDYA` | url | Endereço da API do fornecedor | INFRA — nunca no banco (o Force mantém hosts/segredos fora do ERP) |
| `DHALT` | 23/10/2026 | Última alteração dos parâmetros | — |

Flags em uso: TOPs com `AD_MOBILIDADE`=S: 1000 (com `AD_PULARCONFIRMACAO`=S e `AD_PERMITEFATURARAPP`=S), 1001, 1009, 1051, 1061, 2209, 2309 — é daqui que vem a lista do app, não de tabela própria. Tipos de negociação com `AD_MOBILIDADE`=S: 52 (inclui devoluções 23/24 — o filtro "vendável" precisa de outro critério: `TIPVENDA`/`SUBTIPOVENDA`, a confirmar). Empresa 1: `AD_MOBILIDADE`=S, `AD_CODTIPOPERPAD`=1001; empresa 2: desligada. Pedidos do Vidya: `AD_EXPEDICAO`=S em 3.189 de 3.417 (padrão S).

---

## 3. Regras que estavam "em aberto" e agora estão lidas no fonte

**Preço (R31 / S2) — `GETPRECOTAB_VIDYA`:** com `TIPTABPRECOS`=4: tabela = `TGFPAR.CODTAB` do cliente → versão = `MAX(NUTAB)` da tabela com `DTVIGOR < SYSDATE` → preço = `SNK_GET_PRECO(NUTAB, CODPROD, SYSDATE)` (função nativa do Sankhya, cobre tabelas derivadas por percentual) → se 0, repete na tabela 0 (fallback) → se a unidade pedida está em `TGFVOA`, converte: `DIVIDEMULTIPLICA`='M' ⇒ preço × `QUANTIDADE` × `MULTIPVLR`, senão ÷. Promoção (`GETNUPROMOCAO_VIDYA`, `TGFDES`) por percentual, valor ou preço fixo — vazia na PLAC. **O Force já faz a parte da tabela/versão/fallback (CFG-4/5); falta a conversão por `TGFVOA` (D-G) quando houver unidades alternativas.**

**Status do pedido (P2) — `GETCODSTATUS_VIDYA`:** já especificado na Parte C do prompt do dia (0 CANCELADO … 6 AGUARDANDO LIBERAÇÃO). `AD_TVDYFRCSTS` dá cor e permissões por status: 1 NÃO CONFIRMADO (edita/duplica/exclui), 2 CONFIRMADO (só duplica), 6 AGUARDANDO LIBERAÇÃO (não edita, não exclui), 5 NEGADO, 3 AGUARDANDO FATURAMENTO, 4 FATURADO, 0 CANCELADO, -1 DESCONHECIDO. Serve de regra de edição por estado do ERP no Force.

**Carteira e indicadores (positivação, financeiro) — `VGFPAR_VIDYA`:** carteira = `TGFPAR.CODVEND`; por cliente: `POSITMES`/`POSITSEMANA` = contagem de documentos `TGFCAB` com `TIPMOV` em (P, V) no mês/semana, `QTDPEDIDOS`; `TITVENC` = títulos `TGFFIN` abertos (`DHBAIXA` nulo, `PROVISAO`=N, `RECDESP`=1) com `DTVENC`+1 < hoje, `TITABERTO` = abertos; `LIMCRED`, `LIMCREDMENSAL`, `BLOQUEAR`, `MOTBLOQ`, `SITUACAO`; endereço de entrega em `TGFCPL`; `SUGTIPNEGSAID` (tipo de negociação sugerido). **Isso permite positivação M/S/T/N e os selos financeiros sem espelhar o histórico inteiro: basta um job de agregados por cliente.**

**Financeiro (P6) — `VGFFIN_VIDYA`:** `TGFFIN` com `RECDESP`<>0: `NUFIN`, `NUNOTA`, `DTVENC`, `DHBAIXA`, `VLRDESDOB`, `VLRBAIXA`, `CODEMP`, `CODVEND`; ABERTO = `DHBAIXA` nulo. Colunas confirmadas.

**Estoque — `VGFEST_VIDYA`:** `SUM(ESTOQUE-RESERVADO)` em `TGFEST` no `LOCALPAD` da empresa (o selo "E"). Fora do escopo (P-13), mas a fonte está documentada.

**Lista de TOPs e tipos de negociação do app — `VGFCAB_VIDYA`:** TOPs = `TGFTOP` última versão com `TIPMOV`='P' e `AD_MOBILIDADE`='S'. Tipos = `TGFTPV.AD_MOBILIDADE`='S'.

**O que o app envia (SNK-7) — `AD_TVDYLOGPED`:** cabeçalho `CODTIPOPER`, `CODTIPVENDA`, `DTNEG`, `CODPARC`, `CODVEND`, `CODPARCTRANSP` (quando há), `AD_NUVIDYA` (na criação) ou `NUNOTA` (nas edições: o mesmo pedido é reenviado com o NUNOTA — é o "upsert" do Vidya); itens com `CODPROD`, `QTDNEG` (inteiros na amostra; `USADECQTD`=S), `CODVOL` (PT, CX), `CODLOCALORIG` (209 ou vazio → `LOCALPAD` do produto, 207/208), `VLRUNIT` = preço de tabela (`PRECOBASE`), `PERCDESC` (ex.: 10.03) e `VLRDESC` unitário, `NUTAB` (versão da tabela usada), `VLRIPI` unitário (9,75% nas forminhas; 3,25% no 4158), `NUMPEDIDO2` (ordem de compra). **Confirma D-7 (PERCDESC por item sobre o preço de tabela) e dá o campo da ordem de compra (`NUMPEDIDO2`, P3).** Atenção: esse payload vai do app para o servidor da Vidya, que fala com o Sankhya; o Force fala direto com o Sankhya (`incluirNota`), mas a semântica dos campos é a mesma.

---

## 4. Proposta U-10 — configuração do Plac Force dentro do Sankhya

Princípio: **o que a PLAC já configura no Sankhya, o Force lê; o que é só do Force, ganha tabela própria no Sankhya; o que é segredo ou infraestrutura, nunca entra no ERP.** Nenhuma tela de administração comercial no Force (a W-38 vira "ver configuração", só leitura, com a origem de cada valor).

### 4.1 Camada PONTE (lida do Sankhya, sem recadastro)
Nomes de chave aqui são lógicos; os nomes de implementação são os do prompt da parte 2 (D1/D2), que prevalece.
| Chave do Force (já existe) | Origem no Sankhya |
|---|---|
| `general.defaultCompanyCode` | `TSIEMP` com `AD_MOBILIDADE`=S (1) |
| `sales.orderTopCode` | `TSIEMP.AD_CODTIPOPERPAD` (1001) |
| `sales.eligibleOrderTopCodes` | `TGFTOP` última versão, `TIPMOV`=P, `AD_MOBILIDADE`=S, filtrada por D-A (1000, 1001 no piloto) |
| `sales.quoteTopCodes` (novo) | `AD_TVDYGRUOP` "ORÇAMENTO" → 1000; `AD_TVDYTOPGRU` |
| `sales.skipConfirmationTopCodes` (novo) | `TGFTOP.AD_PULARCONFIRMACAO`=S (1000) — fecha D-4: orçamento não confirma |
| `sales.negotiationTypes` | `TGFTPV` versão vigente com `AD_MOBILIDADE`=S e `ATIVO`=S (35 hoje), menos `sales.negotiationTypeExclusions` do arquivo base (U-10-d) |
| `sales.orderStockLocationCode` | `AD_TVDYCFGFRC.CODLOCALPEDIDOS` (209) |
| `pricing.mobilePriceTableCodes` | `TGFNTA.AD_MOBILIDADE`=S |
| `pricing.catalogReferenceTableCode` | `AD_TVDYCFGFRC.TABPADCSLTPROD` (5) |
| `pricing.fallbackTableCode` | `AD_TVDYCFGFRC.CODTABALT` (5) e tabela 0 (regra do `GETPRECOTAB`) |
| `products.sellableUsageValues` | já em configuração (USOPROD V/R) |
| `products.mobileFlag` | `TGFPRO.AD_MOBILIDADE` |
| `orders.quantityDecimals` | `AD_TVDYCFGFRC.USADECQTD` + `TGFPRO.DECQTD` por produto (4) |
| `orders.discountType` | `AD_TVDYCFGFRC.TIPDESC` (P) |
| `orders.maxDiscountValidation` | `AD_TVDYCFGFRC.VALDESCMAX` (A=avisar) — só quando a fonte do limite por produto existir (D-H) |
| `orders.expedicaoDefault` (novo) | distribuição de `TGFCAB.AD_EXPEDICAO` → padrão S |
| `erp.orderStatusLabels` | `AD_TVDYFRCSTS` (nome, cor, permissões) — D-E |
| `customers.historyDays` | `AD_TVDYCFGFRC.DIASCONSULTAVENDAS` (90) |
| `customers.purchasedWindowDays` | `AD_TVDYCFGFRC.QTDDIASPRODCOMPRADOS` (90) |
| `customers.financialVisible` | `AD_TVDYCFGFRC.UTILFINANC` (S); bloqueios `BLOQVEND*` vazios ⇒ só leitura |
| `goals.*` (Fase B) | `AD_TVDYCFGPFM`, `AD_TVDYDRTIPT`, `AD_TVDYPFMTOP`, `AD_TVDYVEN` |
| Papéis | vendedor = `TSIUSU.CODVEND` → `TGFVEN`; gerente = vendedor referenciado em `TGFVEN.CODGER` (ou `TGFVEN.TIPVEND`, a confirmar) — já é a direção do AUTH-6/7 |

### 4.2 Camada PRÓPRIA (tabelas do Force no Sankhya, criadas por você no Dicionário/Construtor — próxima etapa, U-10-b)
`AD_PLACFORCECFG` (1 linha): `NUCFG`, `VERSAOMINIMAAPP`, `DIASOFFLINEMAX` (7), `MODOALCADA` (ERP/FORCE, padrão ERP), `PERMITEPDF` (S), `PERMITEIMPORTPLAN` (S), `DHALT`, `CODUSUALT`; filhas `AD_PLACFORCETOP` (`CODTIPOPER`, `PERMITIDA`, `PADRAO`) e `AD_PLACFORCETPV` (`CODTIPVENDA`, `PERMITIDA`) — substituem `sales.topAllowlist` e `sales.negotiationTypeExclusions` do arquivo base. Só o que não existe no Vidya e não é segredo. Até existirem, essas chaves ficam no arquivo base (ex-bootstrap), que passa a ser "defaults + chaves só-do-Force". Se um dia o Vidya for desligado, as tabelas `AD_TVDY*` continuam no banco da PLAC; migrar o que for usado para `AD_PLACFORCE*` é um script, não uma decisão de agora.

### 4.3 Camada INFRA (fora do ERP)
Hosts, credenciais, `VERIFIER_*`, `SANKHYA_ORDER_WRITE_*`, `SANKHYA_ORDER_ORIGIN_FIELD`, chaves — continuam em `compose.env`/secrets (STACK-2, SEC-1). O Vidya coloca `HOSTAPIVIDYA` na tabela e o app guarda `CLIENTSECRET` no navegador (F-20): não copiar.

### 4.4 Mecanismo no Force
- Job `sync.configuration` no worker (a cada 15 min, no start e sob demanda por comando), ligado por `CONFIG_SYNC_FROM_SANKHYA=1` (padrão 0 — nada muda no staging até você ligar); lê as origens acima pelo caminho SQL do gateway (consultas Q1–Q8 do prompt da parte 2); grava uma nova `installation_configuration_version` com `source.kind='sankhya'`, `source.base` = versão do arquivo e **proveniência por chave** (tabela.coluna, lida em); leitura falha/parcial = nenhuma versão nova, a vigente continua, falha em `sync_state` e alerta no painel (CFG-8). O worker precisa de INSERT/UPDATE nessa tabela (`db-roles.sql`, deploy com `SF_RUN_DB_ROLES=1`).
- O JSON de bootstrap (`config-bootstrap`, arquivo fora do repositório) vira o **arquivo base**: defaults + chaves só-do-Force (`sales.topAllowlist`, `sales.negotiationTypeExclusions`, vínculos conta→vendedor, políticas de preço sem fonte no Sankhya). O Sankhya sobrepõe as chaves PONTE.
- W-38 "Configurações" = leitura, com origem e "edite no Sankhya"; W-39 some.
- Staging lê o Sandbox: antes do primeiro teste, conferir que `AD_TVDYCFGFRC` e os flags do Sandbox batem com a produção (o Sandbox parece atrasado: menos campos em TGFCAB).

### 4.5 Decisões do dono
- **U-10-a** Ler as tabelas e flags do Vidya como ponte durante o piloto (SIM / NÃO). Recomendação: SIM.
- **U-10-b** Criar `AD_PLACFORCECFG` agora (SIM / ADIAR). Recomendação: ADIAR — hoje o que é só do Force fica no arquivo base; a tabela entra quando o primeiro sync estiver rodando (o prompt da parte 2 documenta o modelo, sem DDL).
- **U-10-c** TOPs do piloto continuam D-A (1000 e 1001), mesmo com 7 habilitadas no Sankhya (SIM / NÃO). Mecanismo: `sales.topAllowlist` no arquivo base; ausente = todas as habilitadas no Sankhya.
- **U-10-d** Tipos de negociação: o Sankhya habilita 35 (`AD_MOBILIDADE`=S, versão vigente), o arquivo de staging lista 18. `TGFTPV.AD_VENDA` (campo do Vidya "Venda?") está vazio em todos — não serve de critério hoje. Recomendação: lista do Sankhya menos `sales.negotiationTypeExclusions` = [23, 24] no arquivo base; alternativa definitiva é a PLAC desligar `AD_MOBILIDADE` em 23/24 no Sankhya (afeta o Vidya também — sua decisão).

---

## 5. Não verificado / pendente
- Em qual ambiente cada export rodou (produção × Sandbox) — confirmar.
- `VGFPAR_VIDYA` veio cortada em 4.000 caracteres (falta o trecho `OUTER APPLY` do fim): `SELECT DBMS_METADATA.GET_DDL('VIEW','VGFPAR_VIDYA','SANKHYA') FROM DUAL` quando precisar.
- Colunas de `TGFIPI` (alíquota de IPI) — a "consulta grande" do início da manhã não foi rodada; o Force pode descobrir pela leitura do Sandbox.
- Onde mora o "desconto máximo por produto" (12%) que o Vidya avisa — não está na `CFGFRC` nem nos fontes lidos; provavelmente no servidor da Vidya ou em coluna de `TGFPRO`/`TGFEXC` (consulta 6 da manhã).
- Significado de `TGFCAB.AD_STATUS` (P/E/A/L) no fluxo do Vidya (1.273 A, 1.969 L, 54 E) — não é necessário para o Force.
- Critério de tipo de negociação vendável (U-10-d).
