# VIDYA_PARITY_MATRIX (trabalho — não commitar)

Fonte: raio-X Vidya (`vidya-force-raiox`) + consultas read-only na base TESTE do Sankhya (2026-09-30). Referência FUNCIONAL; nenhum código Vidya copiado.
Regra: se o Vidya só consome configuração nativa do Sankhya, o Force consome/respeita — sem editor duplicado.

## Vocabulário (preservado)
- **Classe de paridade:** SANKHYA_NATIVE · VIDYA_CONFIGURATION_BRIDGE · FORCE_IMPLEMENTED · FORCE_PARTIAL · NOT_USED_BY_PLAC
- **Estado de validação:** VALIDATED · PENDING_VALIDATION · BLOCKED
- **Lacuna do consumidor:** FORCE_CONSUMER_PENDING (o Sankhya já tem o dado; falta o Force consumir)
- Uma linha pode ter classe + estado. Hipótese nunca vira fato: sem evidência → PENDING_VALIDATION.

## Matriz (estado consolidado, 2026-09-30 fim do dia)

| Área | Comportamento / valor real PLAC (TESTE) | Classe | Estado | Observação |
|---|---|---|---|---|
| Auth/Usuários — login | Login via usuário Sankhya (TSIUSU, NOMEUSU maiúsculo). `MobileLoginSP.login` com GUSTAVO SOUSA → "Usuário/Senha inválido" (CORE_E01434, HTTP 200, status 0; não é FORBIDDEN) | — | BLOCKED → PENDING_VALIDATION | Hipótese LIKELY (não confirmada): usuário vinculado ao Sankhya ID; credencial dominante é a do ID, não a INTERNO. Aguardando owner criar usuário-laboratório na UI do TESTE e rodar o probe. P-11 inalterado. |
| Auth/Usuários — vendedor | TSIUSU.CODVEND (ex.: 7→76) | FORCE_PARTIAL | PENDING_VALIDATION | Só no provisionamento; nunca TGFVEN.CODUSU. Sem vendedor → NO_SELLER_SCOPE. Campo ativo/bloqueio do TSIUSU não validado. |
| Vendedores/Carteira | Carteira = TGFPAR.CODVEND = sellerCode. Configs LIBVENCARTEIRA/LIBVENREGIAO/PESQCLIONBYCODVEND/CLIENTESEMVENDEDOR/UTILCODVENDPARC todas NULL. 799 clientes CODVEND=0 fora; CODASSESSOR não usado. QA: 76→1, 6→111, 72→336 (335 ativos) | FORCE_IMPLEMENTED (política server) | VALIDATED (dados) · PENDING_VALIDATION (comportamento vs Vidya) | Sem vendedor → NO_SELLER_SCOPE. |
| Vendedores — grupos | AD_TVDYFRCGRUVEN | — | PENDING_VALIDATION | Não consultado; futuro, não implementar. |
| Clientes | Espelho TGFPAR CLIENTE='S'; placeholder CODPARC=0 excluído | FORCE_IMPLEMENTED | VALIDATED | Commit local do filtro. |
| Produtos — elegibilidade | TGFPRO: CODPROD>0, ATIVO='S', USOPROD vendável = V,R (configuração da instalação; 'S'(21) e '3'(2) fora). Placeholder CODPROD=0 excluído | FORCE_IMPLEMENTED (leitura com escopo) · SANKHYA_NATIVE | VALIDATED (owner 2026-09-30) | Valores vêm de `products.sellableUsageValues`, nunca literais. |
| Produtos — AD_MOBILIDADE | S=1697, N=176, NULL=2119. Sem regra explícita no raio-X. Dos 1502 V/R ativos com preço na tabela 5, 100% têm 'S'; V/R ativos com N (3) ou NULL (15) não têm preço na tabela 5 | FORCE_PARTIAL (filtro configurável, modo `disabled`) | PENDING_VALIDATION | Semântica sugerida LIKELY (não confirmada). Não bloqueia o mirror; não é persistido ainda. |
| Produtos — destaque/perfil | — | — | PENDING_VALIDATION | Futuro; não implementar. |
| Grupos | TGFGRU hierárquico (CODGRUPAI, raiz -999999999, código 0 = "<SEM GRUPO>"); 1689/1689 produtos V/R ativos têm grupo | SANKHYA_NATIVE · FORCE_IMPLEMENTED (`readProductGroups`) | VALIDATED (dicionário + amostra) | Leitura real implementada e testada localmente; execução real só no ensaio do mirror. |
| Preços — tabela do cliente | GETCODTAB → tabela do parceiro (TIPTABPRECOS=4, USARCODTABEMP='N'). Regra: tabela do cliente (versão vigente) → tabela 0 → promoção → "Sem preço" | SANKHYA_NATIVE | PENDING_VALIDATION (comportamento) | Comportamento conforme motor Oracle; conferir contra o Vidya. Preço ≤ 0 nunca é preço vendável; ausência ≠ 0. |
| Preços — tabelas espelhadas | 0,3,5,6,9 (TGFNTA.AD_MOBILIDADE='S'; 2,7,8 NULL). Versão vigente: 0→8, 3→6, 5→13, 6→12, 9→10 (0 linhas) | SANKHYA_NATIVE · FORCE_IMPLEMENTED (`readPriceTables`/versões com escopo) | VALIDATED (dados) · PENDING_VALIDATION (se AD_MOBILIDADE restringe exibição) | Lista vem de `pricing.mobilePriceTableCodes`. Versão vigente = maior DTVIGOR ≤ hoje + futuras; superseded não espelhadas. |
| Preços — CODTABALT | =5 | — | PENDING_VALIDATION (NEEDS VALIDATION) | NÃO usar como fallback nem implementar sem confirmação no Vidya. Schema só tem `alternativeTable` inativo. |
| Preços — bloqueio unidade | TGFVOA/TGFVOL.AD_BLOQVDY todos NULL (10 / 21) | — | NOT_USED_BY_PLAC | — |
| Promoções | TGFDES (GETNUPROMOCAO) 0 linhas | — | NOT_USED_BY_PLAC | Suportar no motor quando surgir. |
| TOP | TGFTOP.AD_MOBILIDADE='S', TIPMOV='P', ATIVO='S' (última versão): 1000, 1001, 1051, 2209 (uso 12 m: 1001=166, 1000=72, 1051=11, 2209=2). Padrão 1001 (owner). 1007 sem flag, 0 pedidos. 1056/1101/1151/1156/1722/1951 são TIPMOV='V' e não criam pedido. AD_TVDYMOBTOP vazia; MOBILIDADEULTVEND e VALIDITEMOB NULL | SANKHYA_NATIVE | VALIDATED · FORCE_CONSUMER_PENDING | `sales.eligibleOrderTopCodes` / `orderTopCode` na configuração. |
| Layout | NULAYOUT=30 = TGFLAY nativo ("Layout da Nota", TIPMOV=P, XML 17 KB: Cabeçalho com abas Informações/Totais/Cartão/Financeiro/Impostos/Transporte/Campos Adicionais + grade Itens). Informações: NUNOTA(ro), DTNEG, CODTIPOPER(obrig.), CODEMP, CODPARC, CODTIPVENDA(obrig.), OBSERVACAO, CODPARCTRANSP. TGFTOP.NULAYOUT: 1000 e 2209→30; 1007→6; 1001 e 1051→NULL. Vidya só aponta (AD_TVDYCFGFRC.NULAYOUT=30) | SANKHYA_NATIVE | VALIDATED · FORCE_CONSUMER_PENDING | Sem editor no Force. Suporte progressivo SUPPORTED/READ_ONLY/IGNORED_UNTIL_NEEDED (`sales.orderLayout`). |
| Pedidos — empresa | Empresa 1 (TSIEMP.AD_MOBILIDADE=S) | SANKHYA_NATIVE | VALIDATED (owner) · FORCE_CONSUMER_PENDING | `general.defaultCompanyCode`. |
| Pedidos — local de estoque | TGFLOC S: 101,102,203,204,205,209; CODLOCALPEDIDOS=209 (EXPEDIÇÃO) | SANKHYA_NATIVE | PENDING_VALIDATION | Estoque fora do escopo (P-13); `sales.orderStockLocationCode`. |
| Pedidos — tipo de negociação | TGFTPV S=24, N=2, NULL=36 | — | PENDING_VALIDATION | Subconjunto de pagamentos vendáveis. |
| Pedidos — natureza | TGFNAT.AD_MOBILIDADE nenhuma | — | NOT_USED_BY_PLAC | — |
| Pedidos — envio ao ERP | SNK-6: desabilitado até os gates de escrita (V-11, V-13) | — | BLOCKED | Proteção estrutural local: pedidos 1–8 = `legacy_dev` (proveniência, não status) nunca entram no outbox; ver relatório. |
| Pedidos 1–8 (DEV) | LEGACY_DEV, nunca enviar; limpeza só após mirror real pronto | FORCE_PARTIAL | PENDING_VALIDATION (migration 0005 não aplicada no DEV) | Sem execução de limpeza. |
| Status | AD_TVDYFRCSTS / GETCODSTATUS_VIDYA (0-6, -1). Status ERP separado do status de sync do Force (owner 2026-09-30) | SANKHYA_NATIVE (derivação) | VALIDATED · FORCE_CONSUMER_PENDING | Central de Vendas lê o status ERP. |
| Histórico | Histórico de vendas / DIASCONSULTAVENDAS | — | PENDING_VALIDATION | — |
| Financeiro | VGFFIN, limite de crédito; TGFPAR.LIMCRED espelhado | FORCE_PARTIAL | PENDING_VALIDATION | Regras EXIBLIMCRECAR/BLOQVENDPPRAZO a validar. |
| Estoque | Consulta/bloqueio | — | NOT_USED_BY_PLAC | Fora do escopo (P-13). |
| Offline | Sync Force | FORCE_IMPLEMENTED | PENDING_VALIDATION (cache real) | Sync próprio (M1–M5). Validar com dados reais. |
| Performance / Engajamento / Agenda / Mural / Relatórios | AD_TVDYCFGPFM/PFMPRO/PFMTOP · AD_TVDYCFGENG* · AD_TVDYFRCAGD* · AD_TVDYMRL* · AD_TVDYRFE | — | PENDING_VALIDATION | Futuro; não implementar. |
| Configurações | AD_TVDYCFGFRC (1 linha), lidas parcialmente | VIDYA_CONFIGURATION_BRIDGE | PENDING_VALIDATION (CFG-1 PROPOSED) | Force consome; extensão de schema proposta, opcional/retrocompatível. |
