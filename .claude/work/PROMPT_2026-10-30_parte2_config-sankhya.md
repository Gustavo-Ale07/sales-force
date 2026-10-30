# PROMPT 2026-10-30 — parte 2 (configuração do Plac Force lida do Sankhya — U-10/U-11)

Sou o dono (Gustavo). Sessão em C:\Dev\sales-force-evolution. Só comece depois de fechar a parte 1 (CHECKPOINT_2026-10-30-parte1.md existente, HEAD = origin). Leia CURRENT.md, o checkpoint da parte 1 e o arquivo novo .claude/work/VIDYA_SANKHYA_CONFIG_MAP_2026-10-30.md (como o Vidya Force é configurado dentro do Sankhya da PLAC: tabela AD_TVDYCFGFRC, flags AD_MOBILIDADE, views e funções *_VIDYA — lido por mim no DBExplorer, só leitura). Esta parte troca a origem da configuração comercial: hoje é um JSON de bootstrap (U-11); passa a ser lida do próprio Sankhya (CFG-1), como o Vidya faz.

REGRAS: as da parte 1. Docker ligado; TDD; testes, typecheck e lint em tudo que tocar; um commit por item; push só fast-forward de feat/sales-force-evolution ao final da trilha; nada que fale com o Sankhya ou peça senha (o gateway real só ganha código + testes com HTTP mockado, como no slice 1); nada de segredo no repo; não toque em compose.env, flags nem enable-* do staging; não faça deploy; produção nunca. Antes dos testes, pnpm -r --filter "./packages/*" run build. Autonomia total dentro das decisões abaixo; não me pergunte nada; o que exigir Sankhya, segredo ou produção vira "Só o dono roda" no CURRENT.md.

FATOS (registre em decisions.md e no spike como evidência, status VALIDATED (env) 2026-10-30, fonte: DBExplorer, dono):
- O Vidya não tem tela de configuração própria: a configuração inteira mora no Sankhya — uma linha em AD_TVDYCFGFRC (370 colunas, 88 preenchidas, NUCFG = 1), tabelas filhas por NUCFG (AD_TVDYFRCSTS status, AD_TVDYGRUOP/AD_TVDYTOPGRU grupos de TOP), flags AD_MOBILIDADE nos cadastros padrão (TGFTOP, TGFTPV, TGFNTA, TGFPRO, TGFLOC, TSIEMP), TSIEMP.AD_CODTIPOPERPAD, e regras em funções/views *_VIDYA. Detalhes e valores no CONFIG_MAP.
- Versionamento: TGFTOP e TGFTPV são versionadas por DHALTER; a versão vigente é DHALTER = MAX(DHALTER) por código (é o que as views do Vidya fazem; TGFCAB.DHTIPOPER/DHTIPVENDA apontam a versão usada no documento).
- Valores da PLAC hoje: TOPs com AD_MOBILIDADE = S: 1000, 1001, 1009, 1051, 1061, 2209, 2309 (a lista do app vem da VGFCAB_VIDYA, que filtra TIPMOV = P e AD_MOBILIDADE = S na versão vigente); 1000 tem AD_PULARCONFIRMACAO = S. Empresa 1: AD_MOBILIDADE = S, AD_CODTIPOPERPAD = 1001; empresa 2 desligada. 35 tipos de negociação com AD_MOBILIDADE = S (inclui devoluções 23 e 24; TGFTPV.AD_VENDA está vazio em todos). AD_TVDYCFGFRC: CODLOCALPEDIDOS = 209, TABPADCSLTPROD = 5, CODTABALT = 5, TIPDESC = P, VALDESCMAX = A (validar e avisar, não bloqueia), USADECQTD = S, DECVLR = 2, DIASCONSULTAVENDAS = 90, QTDDIASPRODCOMPRADOS = 90, UTILFINANC = S, ALTTIPNEG = S, PERMALTPRECOPROD = N, APLICDESCMSS = S, bloqueios de crédito (BLOQVEND*) vazios. AD_TVDYFRCSTS: 8 status (códigos iguais aos do GETCODSTATUS_VIDYA) com NOME, DESCRICAO, COR (hex) e PERMEDIT/PERMDUPLIC/PERMEXC.
- Os exports de parâmetros, dicionário e log vieram do Sankhya de PRODUÇÃO (log com pedidos de hoje, nº único ~20.700); o catálogo veio do Sandbox. O Sandbox pode estar defasado em relação à produção: a sincronização deve reportar chave a chave o que leu e o que faltou, nunca presumir.

DECISÕES DO DONO (registre em docs/decisions.md como APPROVED 2026-10-30 antes de implementar; CFG-8 novo, U-10 e U-11 resolvidos para o piloto)
U-10-a PONTE: durante o piloto o Force lê as mesmas tabelas e flags que o Vidya usa (lista abaixo). Nada é recadastrado; a PLAC continua configurando nas telas do Sankhya que já usa.
U-10-b Tabelas próprias do Force no Sankhya (AD_PLACFORCE*): ADIADAS. Hoje, o que é só do Force continua no arquivo base (ex-bootstrap). Documente o modelo proposto no contrato (§4.2 do CONFIG_MAP) como "próxima etapa", sem DDL executável.
U-10-c TOPs do piloto: o Sankhya habilita 7, o Force oferece só as da lista do dono (D-A: 1000 e 1001). Chave só-do-Force sales.topAllowlist (opcional): quando presente, eligibleOrderTopCodes = lista do Sankhya ∩ allowlist; ausente = lista do Sankhya inteira. TOP na allowlist que não está habilitada no Sankhya: fora, com aviso no relatório.
U-10-d Tipos de negociação: lista = TGFTPV vigente com AD_MOBILIDADE = S, menos sales.negotiationTypeExclusions (só-do-Force, opcional; piloto: 23 e 24, devoluções). Nunca inferir "devolução" pela descrição.
U-11 Fonte antes do modelo próprio = arquivo base (o mesmo config-bootstrap de hoje) + sobreposição do Sankhya. O arquivo deixa de ser "a configuração" e vira "defaults + chaves só-do-Force".
CFG-8 Precedência e segurança: chave PONTE lida com sucesso no Sankhya sobrepõe o arquivo base; leitura falha/parcial/inválida = nenhuma versão nova, versão atual continua vigente, falha em sync_state (entity = 'configuration') e alerta no painel de integração; nunca regredir para "não configurada" por causa de um sync. Segredos nunca entram no snapshot. O Force nunca escreve configuração no Sankhya (P-02/P-03).

TRILHA D — configuração lida do Sankhya (um commit por item)

D1 Contrato (packages/contracts, InstallationConfigurationSchema, expand-only; o arquivo base atual continua válido sem alteração):
- source.kind ganha 'sankhya' de fato (já previsto); source.base = { kind: 'bootstrap-file', version } quando houver sobreposição; source.syncedAt.
- provenance (opcional): mapa chave → { table, column, filter?, readAt } para cada chave PONTE efetivamente lida; chaves do arquivo base ficam com { source: 'base' }.
- Chaves novas, todas opcionais: sales.topAllowlist (int[]), sales.negotiationTypeExclusions (int[]), sales.quoteTopCodes (int[]: TOPs do grupo "ORÇAMENTO"), sales.skipConfirmationTopCodes (int[]: TGFTOP.AD_PULARCONFIRMACAO = S), sales.orderBehavior.decimalQuantities (bool), erp.orderStatusDisplay ({ code, label, color, canEdit, canDuplicate, canDelete }[]), customers.historyDays (int), customers.purchasedWindowDays (int), general.appMinimumVersion (string, só-do-Force).
- O hash de conteúdo ignora provenance.readAt e source.syncedAt (como já ignora syncedAt).

D2 Gateway (packages/sankhya): implemente readConfiguration() no cliente real pelo caminho SQL já usado nos espelhos (DbExplorerSP.executeQuery, com a mesma autenticação, serialização e tratamento de status = "0" / ORA-), exatamente com estas consultas — nunca SELECT * em AD_TVDYCFGFRC (ela tem colunas de credencial: BASICAUTH, CLIENTSECRET*, KEY*, CERT*; o cliente real deve ter um teste que falha se alguma consulta citar uma coluna cujo nome contenha SECRET, TOKEN, SENHA, PASSWORD, PASS, KEY, CERT ou BASICAUTH):

Q1 parâmetros gerais
SELECT NUCFG, CODLOCALPEDIDOS, TABPADCSLTPROD, CODTABALT, TIPDESC, VALDESCMAX, VALVLRMIN, USADECQTD, DECVLR, DIASCONSULTAVENDAS, QTDDIASPRODCOMPRADOS, UTILFINANC, ALTTIPNEG, PERMALTPRECOPROD, PERMITEDESCNOAPP, APLICDESCMSS, APLICADESCTOT, HABIIMPPLAN, PERMITEIMPRIMIR, TEMPODADOSOFFLINE, BLOQVENDPPRAZO, BLOQVENDCLIINAD, BLOQVENDCLIBLOQ, DIASPARAATRASO, EXIBLIMCRECAR, OCLTLIMCRED, VERSAOMINIMA, DHALT FROM AD_TVDYCFGFRC WHERE NUCFG = 1

Q2 empresas
SELECT CODEMP, NOMEFANTASIA, AD_MOBILIDADE, AD_CODTIPOPERPAD FROM TSIEMP ORDER BY CODEMP

Q3 TOPs habilitadas (versão vigente)
SELECT T.CODTIPOPER, T.DESCROPER, T.TIPMOV, T.AD_MOBILIDADE, T.AD_PULARCONFIRMACAO, T.AD_PERMITEFATURARAPP, TO_CHAR(T.DHALTER, 'YYYY-MM-DD HH24:MI:SS') DHALTER FROM TGFTOP T WHERE T.DHALTER = (SELECT MAX(T2.DHALTER) FROM TGFTOP T2 WHERE T2.CODTIPOPER = T.CODTIPOPER) AND T.AD_MOBILIDADE = 'S' ORDER BY T.CODTIPOPER

Q4 grupos de TOP do Vidya (orçamento × pedido)
SELECT G.NUGRUOP, G.NOME, G.ORDEM, TG.CODTIPOPER FROM AD_TVDYGRUOP G INNER JOIN AD_TVDYTOPGRU TG ON TG.NUCFG = G.NUCFG AND TG.NUGRUOP = G.NUGRUOP WHERE G.NUCFG = 1 ORDER BY G.ORDEM, G.NUGRUOP, TG.CODTIPOPER

Q5 tipos de negociação habilitados (versão vigente)
SELECT P.CODTIPVENDA, P.DESCRTIPVENDA, P.ATIVO, P.AD_MOBILIDADE, P.AD_VENDA, TO_CHAR(P.DHALTER, 'YYYY-MM-DD HH24:MI:SS') DHALTER FROM TGFTPV P WHERE P.DHALTER = (SELECT MAX(P2.DHALTER) FROM TGFTPV P2 WHERE P2.CODTIPVENDA = P.CODTIPVENDA) AND P.AD_MOBILIDADE = 'S' ORDER BY P.CODTIPVENDA

Q6 tabelas de preço habilitadas
SELECT N.CODTAB, N.AD_MOBILIDADE FROM TGFNTA N ORDER BY N.CODTAB

Q7 status do pedido (rótulo, cor, permissões)
SELECT CODSTATUS, NOME, DESCRICAO, COR, PERMEDIT, PERMDUPLIC, PERMEXC FROM AD_TVDYFRCSTS WHERE NUCFG = 1 ORDER BY CODSTATUS

Q8 distribuição de AD_MOBILIDADE nos produtos (só para o relatório; não decide nada hoje)
SELECT AD_MOBILIDADE, COUNT(*) QTD FROM TGFPRO GROUP BY AD_MOBILIDADE

Mapeamento (chave do Force ← origem; converta 'S'/'N' em booleano; número como número; valor nulo = chave não lida, não "false"):
general.enabledCompanyCodes ← Q2 CODEMP com AD_MOBILIDADE = S; general.defaultCompanyCode ← a única empresa habilitada (mais de uma: mantém o base e avisa).
sales.orderTopCode ← Q2 AD_CODTIPOPERPAD da empresa padrão (obrigatoriamente presente em Q3; senão mantém o base e avisa).
sales.eligibleOrderTopCodes ← Q3 CODTIPOPER com TIPMOV = P (∩ sales.topAllowlist quando presente — U-10-c).
sales.quoteTopCodes ← Q4 CODTIPOPER do grupo cujo NOME, sem acento e em maiúsculas, é ORCAMENTO; sales.quotationTopCode ← o primeiro deles se único (senão mantém o base). sales.skipConfirmationTopCodes ← Q3 com AD_PULARCONFIRMACAO = S.
sales.negotiationTypes ← Q5 (code = CODTIPVENDA, label = DESCRTIPVENDA) com ATIVO = S, menos sales.negotiationTypeExclusions (U-10-d).
sales.orderStockLocationCode ← Q1 CODLOCALPEDIDOS. sales.orderBehavior.decimalQuantities ← Q1 USADECQTD.
pricing.mobilePriceTableCodes ← Q6 CODTAB com AD_MOBILIDADE = S. pricing.catalogReferenceTableCode ← Q1 TABPADCSLTPROD. pricing.alternativeTable.tableCode ← Q1 CODTABALT (active continua do base). pricing.fallbackTableCode NÃO vem do Sankhya (o fallback 0 está no código do Vidya, não em parâmetro — CFG-4 continua configuração do base).
customers.historyDays ← Q1 DIASCONSULTAVENDAS; customers.purchasedWindowDays ← Q1 QTDDIASPRODCOMPRADOS; customers.creditFeatures.showCreditLimit ← NOT(OCLTLIMCRED = S).
erp.orderStatusDisplay ← Q7 (label = NOME, color = '#' + COR; canEdit/canDuplicate/canDelete ← PERM*). Os rótulos D-E do domínio continuam o fallback quando a chave não existir; a precedência de código continua em mapErpOrderStatus, nunca na tabela.
financial.showFinancialArea ← Q1 UTILFINANC SOMENTE depois que o P6 (financeiro só leitura) existir; até lá o valor lido vai só para o relatório. Idem para qualquer chave cuja funcionalidade ainda não exista: ler, reportar, não aplicar.
general.appMinimumVersion, sales.topAllowlist, sales.negotiationTypeExclusions, customers.portfolioOwnership, customers.accountSellerLinks, customers.customerWithoutPriceTable, products.*, pricing.customerTableStrategy/fallbackStrategy/fallbackTableCode/missingPrice, sales.orderLayout, sales.confirmationBehavior, sales.discountAuthority, features.* ← arquivo base (só-do-Force por enquanto).
Fake gateway: devolve o equivalente a partir de uma fixture em código com os valores da PLAC acima (só códigos e descrições de TOP/negociação; nenhum nome de pessoa), para os testes e o modo fake.

D3 Worker: job sync.configuration (apps/server/src/sync), a cada 15 min e no start do worker, ligado por CONFIG_SYNC_FROM_SANKHYA=1 (padrão 0 = job não registrado; nada muda no staging até eu ligar). Fluxo: carrega a versão vigente; exige uma versão base (a última com source.kind = 'bootstrap-file'; sem ela = instalação não configurada, falha fechada); lê Q1–Q8 pelo gateway; monta o snapshot = base ⊕ PONTE; valida com o schema e com as regras de consistência do domínio (as mesmas do config-bootstrap); hash diferente = INSERT de nova installation_configuration_version com source.kind = 'sankhya', source.base = versão base, provenance preenchida, is_current trocado na mesma transação; hash igual = no-op registrado. Qualquer erro (HTTP, ORA-, coluna ausente, tabela ausente, consistência) = nada gravado, sync_state entity 'configuration' com a causa, alerta no painel de integração; a versão vigente não muda (CFG-8). Toda versão nova gera entrada no log de auditoria com versão anterior, nova e a lista de chaves alteradas (o guard-rail do contrato §4.3). Relatório do sync (log estruturado, sem dados pessoais): chave, valor anterior, valor novo, origem, mais as leituras só-informativas (Q8, UTILFINANC, parâmetros sem funcionalidade). Rodar uma vez por comando (pnpm --filter server exec node dist/worker.js --once sync.configuration, ou o equivalente que já exista para os espelhos) para eu disparar sob demanda; o API não enfileira nada (force_api não tem grant no pgboss e assim continua).
Grants: deploy/staging/db-roles.sql — force_worker ganha INSERT e UPDATE em installation_configuration_version (UPDATE só de is_current; se o schema permitir, restrinja por coluna), matriz de privilégios e UNDETERMINED 1 atualizados; teste de papéis restritos (apps/server restricted-roles) cobre o job gravando como force_worker e o API continuando sem escrita. Documente em README-staging: o próximo deploy precisa de SF_RUN_DB_ROLES=1.

D4 config-bootstrap continua existindo e passa a ser documentado como "arquivo base": o mesmo comando, o mesmo caminho, o mesmo papel force_migrator. Se eu reexecutar o bootstrap com conteúdo novo, ele vira a versão vigente (kind bootstrap-file) e o sync seguinte sobrepõe o Sankhya de novo — determinístico, sem perda. O API serve GET /api/v1/configuration com source.kind, source.base e provenance (perfil admin/técnico completo; vendedor continua recebendo o subconjunto seguro do CFG-7, sem provenance).

D5 Web W-38 "Configurações": somente leitura, por grupo, cada valor com a origem ("Sankhya: TGFTOP.AD_MOBILIDADE", "arquivo base") e a data da última sincronização; faixa "Edite no Sankhya; o Force lê a cada 15 min"; estado da última sincronização (ok / falhou com motivo) e as leituras só-informativas. Nenhum formulário de edição comercial no Force (W-39 segue oculta pelo modo 'erp' da parte 1). Mobile: sem tela nova; consome a configuração pela API como hoje.

D6 Documentos: docs/decisions.md (CFG-8, U-10-a..d, U-11 resolvido, nota de status); docs/implementation/sankhya-configuration-contract.md reescrito como modelo físico: camada PONTE (tabela.coluna por chave, consultas Q1–Q8), camada BASE (chaves só-do-Force), camada INFRA (fora do ERP), e a proposta AD_PLACFORCE* para a próxima etapa (campos sugeridos: NUCFG, VERSAOMINIMAAPP, DIASOFFLINEMAX, MODOALCADA, PERMITEPDF, PERMITEIMPORTPLAN, DHALT, CODUSUALT; filhas AD_PLACFORCETOP com CODTIPOPER/PERMITIDA/PADRAO e AD_PLACFORCETPV com CODTIPVENDA/PERMITIDA — documentadas, não criadas); deploy/README-staging.md (seção "Configuração lida do Sankhya": grants, CONFIG_SYNC_FROM_SANKHYA, comando sob demanda, como ler o relatório, como voltar: CONFIG_SYNC_FROM_SANKHYA=0 e, se preciso, reexecutar o config-bootstrap); CURRENT.md.

D7 Testes mínimos: tabela de decisão da sobreposição (base ⊕ PONTE, allowlist, exclusões, empresa única/múltipla, TOP padrão ausente em Q3, grupo ORÇAMENTO ausente); fail-closed (HTTP 403 GTW3403, status "0" com ORA-00904/ORA-00942, linha a menos em Q1, valor fora do domínio) → versão vigente intacta e sync_state preenchido; hash igual = no-op; auditoria com chaves alteradas; teste de "nenhuma coluna de credencial nas consultas"; contrato do cliente real com HTTP mockado reproduzindo o envelope do DbExplorerSP (fieldsMetadata/rows); CFG-7 (vendedor não recebe provenance nem chaves administrativas); W-38 renderiza origem e estado.

D8 security-reviewer da trilha (foco: nada de credencial nas consultas e nos logs, grants mínimos, snapshot sem dados pessoais, fail-closed); push.

SÓ O DONO RODA (escreva assim no CURRENT.md, desligado):
1. Deploy do novo SHA com SF_RUN_DB_ROLES=1 (grants do worker).
2. Em /opt/force-staging/config/compose.env: CONFIG_SYNC_FROM_SANKHYA=1; recriar o worker com deploy/scripts/sf-compose.sh (parte 1, A2).
3. Disparar o sync uma vez pelo comando sob demanda; ler o relatório; conferir GET /api/v1/configuration (source.kind = 'sankhya', source.base = versão do arquivo) e a W-38.
4. Diferenças esperadas no primeiro sync contra o arquivo de staging de 2026-10-02: negotiationTypes 18 → 33 (35 habilitados menos 23 e 24), mobilePriceTableCodes conforme TGFNTA.AD_MOBILIDADE, catalogReferenceTableCode null → 5, alternativeTable.tableCode 5, eligibleOrderTopCodes = {1000, 1001} se topAllowlist = [1000, 1001] no arquivo base (senão 7 TOPs), skipConfirmationTopCodes = [1000], orderStatusDisplay com 8 status. Qualquer outra diferença = investigar antes de seguir.
5. Para voltar: CONFIG_SYNC_FROM_SANKHYA=0 e recriar o worker; a última versão bootstrap-file pode ser reativada reexecutando o config-bootstrap com o arquivo.

FECHAMENTO: .claude/work/CHECKPOINT_2026-10-30-parte2.md; CURRENT.md ("Onde paramos", "Por onde retomar", "Só o dono roda"). Relatório só com: hashes por item, contagens de testes/typecheck/lint, achados do reviewer e o que foi feito com cada um, lista final de chaves PONTE × BASE, e pendências minhas.
