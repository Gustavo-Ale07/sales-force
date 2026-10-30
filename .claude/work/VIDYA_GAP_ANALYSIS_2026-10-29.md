# Vidya Force × Plac Force — análise de paridade para o piloto (2026-10-29)

Fontes: auditoria somente-leitura do Vidya Force web v2.1.224 (perfil vendedor 11; arquivo `auditoria_vidya_force.md`, IDs V-001…V-097, problemas F-01…F-24, travas T-01…T-07, pendências G-1…G-20) cruzada com o estado do Plac Force em `bd6d593` (staging em `AUTH_MODE=external`, alçada de desconto no ar, envio ao ERP desligado) e com `.claude/work/VIDYA_PARITY_MATRIX.md` (raio-X do banco, 30/09).

Limite da auditoria: só o perfil vendedor, só a web. Gerente/admin do Vidya e o app Android ficaram de fora (G-1, G-18). Nada disso afeta o piloto: a administração do Force é desenho nosso, e o app Vidya pode ser gravado em vídeo depois.

Legenda de estado no Force: **PRONTO** · **PARCIAL** · **FALTA** · **VERIFICAR** (confirmar no código antes de implementar) · **FASE B** (depende do espelho de documentos do ERP, SNK-8) · **NÃO COPIAR** (o Vidya faz pior) · **DECISÃO** (do dono).

---

## 1. Veredito

1. **O núcleo do pedido já tem paridade** com o que o vendedor usa todo dia (seção E da auditoria): escolher cliente, catálogo com preço da tabela do cliente, carrinho, desconto por item, em massa e por grupo, lançamento múltiplo, rascunho, duplicar, pedidos recorrentes. Em alçada o Force é **melhor**: o Vidya avisa e deixa passar (F-02, T-01); o Force trava no servidor e roteia para aprovação.
2. **O que impede o piloto hoje são 8 itens (P1–P8 abaixo)**, dos quais 1 é o envio ao Sankhya (já planejado, SNK-7) e 7 são complementos do cabeçalho, do acompanhamento e da ficha do cliente que o vendedor espera porque o Vidya tem.
3. **O que o Vidya tem e pode esperar a Fase B** (espelho de notas/itens do ERP): positivação, "comprados / último pedido / mais vendidos / valor da última compra", análise do cliente, metas e ranking. No piloto em paralelo o Vidya continua cobrindo isso.
4. **Há 7 comportamentos do Vidya que não devem ser copiados** (seção 5).

---

## 2. Cruzamento por funcionalidade (V-ID → Force)

### Home / metas / engajamento (V-001…V-010, V-088…V-094)
| V-ID | Vidya | Force hoje | Classe |
|---|---|---|---|
| V-001, V-093 | Mural de comunicação (vazio) | não existe | pós-piloto (não usado pela PLAC hoje) |
| V-002…V-009, V-088 | Meta "Objetivo de Vendas", % atingido, mês a mês, ranking (só o próprio vendedor) | não existe (RF-GOL-1, S6/R28 abertos) | FASE B / S6 |
| V-010, V-091 | Engajamento Ferro/Bronze/Prata/Ouro (sem dados) | não existe | fora do piloto |
| V-089 | Positivação M/S/H/T/N na carteira | não existe (precisa de notas) | FASE B |
| V-090, V-092, V-094 | Comissões, agenda, notificações: **não existem no Vidya web** | não existem | sem lacuna |

### Conta (V-011…V-016)
| V-ID | Vidya | Force | Classe |
|---|---|---|---|
| V-012 | Trocar senha | vendedor não tem senha local (AUTH-6): senha é do Sankhya | sem lacuna (documentar na tela "sua senha é a do Sankhya") |
| V-013, V-016 | Info do servidor e versão | perfil mostra versão/ambiente | PRONTO |
| V-015 | "Sincronizar" | web lê o Force; "Atualizar dados" recarrega | PRONTO (equivalente) |

### Clientes (V-017…V-036)
| V-ID | Vidya | Force | Classe |
|---|---|---|---|
| V-018, V-029 | Carteira com busca, paginação, selos | carteira por vendedor, busca, detalhe | PRONTO |
| V-017, V-021 | Indicadores e filtro de positivação | — | FASE B |
| V-020 | Filtro status A/E/I | status do parceiro vem do espelho (ativo/inativo/bloqueado → `customer_ineligible`) | PARCIAL: expor filtro de status na lista |
| V-022 | Filtro financeiro (inadimplente, bloqueio a prazo, títulos, protesto) | — | **P6** |
| V-023 | Região/cidade/tipo | cidade/UF espelhadas | PARCIAL (filtro por cidade/UF é barato; região não usada pela PLAC: F-11) |
| V-025, V-053 | Nome fantasia × razão social | — | pós-piloto (preferência de exibição) |
| V-028, V-046 | Exportar carteira/catálogo | proibido para representante (P-20); interno sem permissão explícita | NÃO COPIAR para PJ; interno = decisão |
| V-030 | Ficha: cadastro, tabela de preço, classificação ICMS, IE, 3 endereços | ficha com cadastro básico | PARCIAL: mostrar tabela de preço, classificação ICMS, IE e endereços de entrega/cobrança (só leitura, do espelho TGFPAR) |
| V-031 | **Vendedor edita o cadastro, inclusive tabela de preço** | vendedor não edita (P-18/P-19) | NÃO COPIAR (F-18) |
| V-032 | Financeiro: limite, bloqueado, situação, títulos em aberto/vencidos, 2ª via de boleto | "Limite de crédito: não disponível" | **P6** (2ª via de boleto: pós-piloto) |
| V-033 | Análise do cliente (KPIs, últimas vendas, produtos vendidos, **contatos**) | histórico só de pedidos Force | FASE B; contatos (RF-CON-1/2, espelho TGFCTT, só leitura) = quick win pós-piloto |
| V-035 | Vendas do cliente (pedidos e notas) | pedidos Force do cliente | PARCIAL → completa com P2 |
| V-036 | Cliente novo em 3 etapas, CNPJ/CEP, "Em Análise" | não existe (RF-ACC-3, S5/R27) | pós-piloto; **a lista de campos do Vidya é insumo para o R27** (seção 8) |

### Catálogo (V-037…V-049)
| V-ID | Vidya | Force | Classe |
|---|---|---|---|
| V-037, V-045, V-047 | Busca configurável, grade/lista, paginação | busca, grade/lista, filtros | PRONTO |
| V-038, V-039 | Cliente no contexto do catálogo (preço da tabela dele, crédito, negociação mais usada) | preço pela tabela do cliente no pedido; catálogo mobile usa tabela de referência | PARCIAL: contexto de cliente no catálogo web; mobile ver MOB-8 (§8.8) |
| V-040, V-064 | TOP escolhida pelo vendedor (7 TOPs) | TOP fixa da configuração (1001) | **P3 / DECISÃO D-A** |
| V-041, V-066 | Tipo de negociação (21 opções, inclui devoluções 23/24) | lista de negociação existe (CFG) | **P3**: VERIFICAR que 23/24 e tipos não vendáveis ficam fora; sem padrão até existir histórico |
| V-042 | 204 grupos planos, minúsculas | grupos hierárquicos do espelho | PRONTO (melhor) |
| V-043, V-071 | Comprados / último pedido / mais vendidos / rupturas / destaque / promoção | só "repetir último pedido" e modelos (pedidos Force) | FASE B (precisa do histórico do ERP); promoções/destaque não usados pela PLAC; rupturas = estoque, fora (P-13) |
| V-044, V-074 | Preferências (sem preço, não comprados, 30 por busca) | — | pós-piloto |
| V-048 | Selo "E" sem legenda (estoque) | estoque fora do escopo (P-13) | sem lacuna |
| V-049 | Detalhe do produto: imagens, última venda, IPI/ST, unidades alternativas, preço mínimo, histórico | detalhe com imagem e preço | PARCIAL: IPI (P5); unidades alternativas e preço mínimo = VERIFICAR fonte (seção 7) |

### Vendas / pedido (V-050…V-087)
| V-ID | Vidya | Force | Classe |
|---|---|---|---|
| V-050 | Cartões Nota/Orçamento/Pedido (pendentes, confirmados, ticket) | dashboard do vendedor | FASE B (precisa de notas) |
| V-051, V-057, V-058 | Lista com abas por tipo, filtros (nº, nota, OC, programação, período, status, cliente) | lista com filtros | PARCIAL → status e nota com P2; OC/programação com P3 |
| V-059, V-085 | Compartilhar/imprimir pedido (2 modelos Sankhya), DANFE, XML | — | **P7** (DANFE/XML: pós-piloto) |
| V-060, V-086 | Detalhe: linha do tempo pedido → NF-e, itens com Qtd. Fat / Qtd. Corte, liberações, totais com IPI/ST/frete | detalhe Force | **P2** (NF e corte: após validação S3.3) |
| V-061 | Cabeçalho com crédito, selos, negociação mais usada | cabeçalho com cliente, tabela, "limite não disponível" | **P6** (crédito/selos) |
| V-063 | Dt. Neg. padrão hoje | data do pedido | PRONTO |
| V-065 | Empresa automática (1) | configuração | PRONTO |
| V-067 | Observação (vendedores pedem desconto por aqui) | observação | PRONTO; no Force o desconto vai pela alçada, não pela observação |
| V-068 | Transportadora (lista de 14) | — | **P3** |
| V-069 | Expedição S/N | — | **P3** (VERIFICAR campo no TGFCAB) |
| V-070 | Busca por código/barras/descrição/referência | busca | PRONTO |
| V-072, V-073, V-078 | Produtos/Carrinho/Lançamento múltiplo, quantidade com 4 decimais | abas Produtos/Carrinho, lançamento múltiplo | PRONTO; **VERIFICAR quantidade decimal (0,2 = 1 pacote) e unidade (PT/CX)** → **P4** |
| V-075, T-01 | Limite de desconto por produto (ex.: 12%), aviso que não trava | limite por nível (5/15/30) travado no servidor, roteamento e fila | PRONTO (melhor); limite **por produto** = VERIFICAR fonte no Sankhya (seção 7) e DECISÃO D-H |
| V-076 | Desconto no total (cabeçalho) | só por item/massa/grupo (DISC-1) | DECISÃO D-F (recomendação: não, R35) |
| V-077 | Aplicar desconto em lote: todos / só sem desconto / somar | desconto em massa | PARCIAL: os 3 modos são baratos |
| V-079, F-24 | Descartar / Salvar e sair / Confirmar; descartar sem confirmação | Descartar / Salvar rascunho / Enviar ao ERP | PRONTO; **P8**: confirmar antes de descartar |
| V-080 | Preço de tabela sem IPI, total com IPI | total estimado sem impostos | **P5** |
| V-081 | Orçamento = TOP 1000, confirmável | não existe orçamento | **P3 / DECISÃO D-B** (BP-03) |
| V-082 | Duplicar em qualquer situação | duplicar | PRONTO |
| V-083 | Importar planilha (lista de documentos importados, confirmar um a um) | importação CSV/colar; XLSX conforme IMP-1 | VERIFICAR formatos implementados; assistente completo = pós-piloto |
| V-084 | Identificador de produtos com IA (arquivo/texto/áudio) | — | Fase 3 (RF-IA-5) |
| V-087, F-23 | Vendedor só consulta liberações; "Confirmar" visível em pedido aguardando liberação | fila W-20, estados próprios, auditoria | PRONTO (melhor) |

### Administração e mobile (V-095…V-097)
Sem paridade a buscar: o Vidya não expõe administração ao vendedor; a nossa é desenho próprio (W-33…W-40). App: verificar no celular (G-18).

---

## 3. Itens obrigatórios para o piloto (P1–P8)

| # | Item | Vidya | Force hoje | O que fazer | Validação antes | Decisão |
|---|---|---|---|---|---|---|
| **P1** | Pedido chega no Sankhya com NUNOTA | nasce no Sankhya | desligado | SNK-7 (plano S1–S10) | S3 já provado | D-1..D-10 do plano |
| **P2** | Status do ERP e faturamento no pedido | 8 rótulos (AGUARDANDO LIBERAÇÃO, CONFIRMADO, FATURADO, NEGADO, CANCELADO, NÃO CONFIRMADO, AGUARDANDO FATURAMENTO, DESCONHECIDO), nº da NF, linha do tempo | só estado do Force | mapear STATUSNOTA/PENDENTE/TSILIB → rótulos (mesmo vocabulário do Vidya) a partir da leitura do pedido criado (fatia de leitura do SNK-7); NF via TGFVAR depois de S3.3 | fonte de `GETCODSTATUS_VIDYA` (seção 7) | D-E (adotar o vocabulário do Vidya) |
| **P3** | Cabeçalho completo | TOP, negociação, transportadora, expedição S/N, Nº O.C., programação | TOP fixa, negociação | TOP selecionável entre as permitidas; negociação só vendáveis; transportadora (espelho de parceiros transportadora); expedição, Nº O.C. e programação se existirem no TGFCAB | campos que o Vidya grava no TGFCAB (seção 7) | D-A, D-B, D-C |
| **P4** | Quantidade decimal e unidade | 4 decimais; unidade PT (CX em um caso) | VERIFICAR | garantir `0,2`/`0,4`… aceito ponta a ponta (web, mobile, domain, contrato, SNK-7 com `QTDNEG` decimal e `CODVOL`); teste com a regra PLAC (1,0 = caixa = 5 pacotes) | TGFVOA/TGFVOL por produto | D-G (unidades alternativas no piloto?) |
| **P5** | IPI estimado nos totais | tabela sem IPI, total com IPI por item | sem impostos | mostrar "IPI estimado" e "Total com IPI (estimado)", rotulado como estimativa; valores reais vêm do Sankhya após o envio | fonte da alíquota (TGFPRO/TGFIPI) — S2.4 | D-D |
| **P6** | Financeiro do cliente, só leitura | limite, bloqueado, situação, títulos em aberto/vencidos, selo inadimplente | "não disponível" | espelho de títulos em aberto (TGFFIN) + `LIMCRED`; aba Financeiro (W-10) e selos na carteira/cabeçalho; **sem bloqueio automático** (RF-ORD-3 fica para S4) | regras EXIBLIMCRECAR/BLOQVENDPPRAZO só documentadas | D-I (só leitura no piloto) |
| **P7** | PDF do pedido para compartilhar | 2 modelos do Sankhya | — | template HTML próprio (marca PLAC, sem custo/margem) → PDF no servidor; botão na lista e no detalhe; WhatsApp/e-mail por link | — | D-J (modelo próprio × relatório Sankhya) |
| **P8** | Acabamentos de vocabulário e UX | — | rodapé do carrinho ainda diz "aprovação por alçada… não disponível" | corrigir o texto; confirmar antes de descartar; rótulos de estado em português igual ao Vidya; filtro de status na carteira | — | — |

Ordem sugerida: P1 → P8 (horas) → P4 (horas) → P3 → P2 → P7 → P6 → P5. P4 e P8 cabem no mesmo dia do P1.

---

## 4. Fase B / pós-piloto (não bloqueiam o piloto em paralelo com o Vidya)
- Histórico de compras do ERP por cliente e por produto (V-033, V-043, "Vlr. Ult. Compra", positivação M/S/H/T/N, cartões de vendas) — SNK-8 / R42.
- Metas, ranking, engajamento (S6/R28).
- Cliente novo com CNPJ/CEP e aprovação (S5/R27) — campos em §8.
- Contatos do Sankhya (TGFCTT) na ficha — quick win.
- 2ª via de boleto, DANFE e XML.
- Assistente completo de importação de planilha; identificador por IA (Fase 3).
- Unidades alternativas e preço mínimo por produto (após validação).
- Preferências de exibição (razão social, produtos sem preço).

---

## 5. Não copiar do Vidya
| Vidya | Motivo | Força no Force |
|---|---|---|
| F-02/T-01 aviso de desconto que não trava | furo de alçada | servidor trava (DISC-2/3) |
| F-20 `CLIENTSECRET` no navegador | segredo no cliente | STACK-2: credencial só no worker/verifier |
| F-18/V-031 vendedor altera tabela de preço do cliente | fura a política de preço | P-18/P-19 |
| F-01 "Desc. Unit." com desconto total e unitário negativo | erro de cálculo | domain único (P-14) |
| F-05 total soma pedido + nota do mesmo negócio | duplica valor | separar documento e nota |
| F-17 tipos de devolução na lista de negociação | erro operacional | só tipos vendáveis |
| F-24 descartar sem confirmação | perda de trabalho | confirmar |

---

## 6. Decisões do dono (uma palavra cada)
| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| D-A | TOPs disponíveis ao vendedor no piloto | (a) só 1001; (b) 1001 + 1000 orçamento; (c) também 1051 bonificação e 1061 amostra; (d) todas as 7 do Vidya | **(b)**; 1051/1061 na semana seguinte, ZFM só com decisão fiscal |
| D-B | Orçamento (TOP 1000) no Force | (a) pedido com TOP 1000, convertível em 1001 ("confirmar"); (b) documento separado; (c) fora do piloto | **(a)** — resolve BP-03 sem modelo novo |
| D-C | Transportadora | (a) opcional, sem padrão; (b) obrigatória; (c) padrão = transportadora do último pedido do cliente | **(a)** no piloto; (c) quando houver histórico |
| D-D | IPI estimado nos totais | SIM / NÃO | **SIM**, rotulado como estimativa, após validar a alíquota |
| D-E | Vocabulário de estados = rótulos do Vidya | SIM / NÃO | **SIM** (os vendedores já conhecem) |
| D-F | Desconto no total (cabeçalho) | SIM / NÃO | **NÃO** (R35: sem desconto no cabeçalho no MVP) |
| D-G | Unidades alternativas (CX) no piloto | SIM / NÃO / ADIAR | **ADIAR** até validar TGFVOA |
| D-H | Limite de desconto por produto (além do nível) | SIM / NÃO / ADIAR | **ADIAR**: descobrir a fonte primeiro |
| D-I | Financeiro do cliente no piloto | só leitura / com bloqueio / fora | **só leitura** |
| D-J | PDF do pedido | modelo próprio / relatório do Sankhya / os dois | **modelo próprio** |

---

## 7. Só o dono roda (DBExplorer, Sandbox, só leitura)
Cada consulta responde uma validação acima. Cole só o resultado (sem CPF/CNPJ/nome de pessoa).

1. **Mapa de status (P2, G-4)** — fonte da função que o Vidya usa:
   - Oracle: `SELECT TEXT FROM ALL_SOURCE WHERE NAME = 'GETCODSTATUS_VIDYA' ORDER BY LINE`
   - SQL Server: `SELECT OBJECT_DEFINITION(OBJECT_ID('GETCODSTATUS_VIDYA'))`
   Entrega: quais colunas (STATUSNOTA, PENDENTE, TSILIB, TGFVAR…) definem cada código 0–6/-1 e os rótulos.
2. **Campos que o Vidya grava no cabeçalho (P3)** — um pedido criado pelo Vidya, visto na auditoria:
   `SELECT * FROM TGFCAB WHERE NUNOTA = 20381` (se não existir no Sandbox, qualquer pedido TOP 1001 recente criado pelo Vidya). Entrega: lista das colunas preenchidas (nomes e valores não pessoais), em especial CODPARCTRANSP, campos AD_*, NUMPEDIDO2/ordem de compra, DTPREVENT/programação, expedição.
3. **Transportadoras (P3)**: `SELECT CODPARC, NOMEPARC, ATIVO FROM TGFPAR WHERE TRANSPORTADORA = 'S'` — conferir se 5768 (usada nos pedidos) e 5842 (PLAC) aparecem e por que 5768 não está na lista do Vidya.
4. **Alíquota de IPI por produto (P5)**: `SELECT CODPROD, CODIPI FROM TGFPRO WHERE CODPROD IN (4158, 13, 2804)` e `SELECT * FROM TGFIPI WHERE CODIPI IN (<os códigos acima>)`. Entrega: tabela e coluna da alíquota.
5. **Unidades (P4/D-G)**: `SELECT * FROM TGFVOA WHERE CODPROD IN (4158, 1440, 2804)` e `SELECT CODPROD, CODVOL, DECQTD FROM TGFPRO WHERE CODPROD IN (4158, 1440, 2804)`. Entrega: há CX/PT com fator? `DECQTD` (casas decimais permitidas na quantidade)?
6. **Limite de desconto por produto (D-H)**: `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPRO' AND (COLUMN_NAME LIKE '%DESC%' OR COLUMN_NAME LIKE '%MIN%')` (SQL Server: `INFORMATION_SCHEMA.COLUMNS`). Entrega: nome da coluna que guarda "desconto máximo"/"preço mínimo", se existir; se não, o limite vem do Vidya.
7. **Títulos (P6)**: `SELECT COUNT(*) FROM TGFFIN WHERE CODPARC = 1758 AND DHBAIXA IS NULL AND RECDESP = 1` e um `SELECT TOP 5`/`ROWNUM <= 5` das colunas NUFIN, NUNOTA, DTVENC, VLRDESDOB, DHBAIXA, PROVISAO, CODTIPTIT. Entrega: confirmação das colunas para "em aberto" e "vencido".

---

## 8. Insumos para spikes futuros (vindos da auditoria)
- **R27 / cliente novo (S5)** — campos do Vidya: PJ: CNPJ (consulta), IE, Classificação ICMS (Consumidor Final Não Contribuinte, Isento de ICMS, Produtor Rural, Revendedor, Usa a da TOP, Consumidor Final Contribuinte), Nome Fantasia*, Razão Social*, Celular*, Telefone, Email*, E-mail para NF*, Tipo de geração de boleto (Enviar e-mail / Imprimir / Preparar); PF: CPF, Nome*, Nome Fantasia*, Celular*, Telefone, Email*, E-mail NF*; etapa 2: tabela de preço (TABELA PRINCIPAL V.1 / X_TAB2); etapa 3: CEP*, Complemento, Cidade*, Nº*, Endereço*, Bairro*, Mun. domicílio fiscal*, Estado*, Região, entrega e cobrança. Cliente novo entra como "E – Em Análise".
- **Tipos de negociação vistos** (códigos): 11, 12, 13, 14, 15, 16, 145, 18, 2, 3, 4, 5, 6, 25, 26, 45, 56, 105 (vendáveis); 48 bonificação; 23 e 24 devoluções (excluir).
- **TOPs vistas**: 1000, 1001, 1009, 1051, 1061, 2209, 2309. Parâmetro da empresa `CODTIPOPER` = 1000; `TRABCOMIPI` = S (PLAC) / N (STAR FEST). A PLAC tem 2 empresas habilitadas no Vidya (PLAC e STAR FEST), mas só a 1 aparece nos pedidos.
- **Transportadoras listadas**: 5842, 6768, 6419, 5864, 6051, 6765, 6395, 6423, 6707, 6642, 6151, 6087, 6216, 6450 (e 5768 usada nos pedidos, ausente da lista).
- **Modelos de impressão do Sankhya**: NURFE 168 "RELATÓRIO VIDYA FORCE" e 176 "[INX] MODELO DE PEDIDOS V2".
- **Rótulos de status**: CONFIRMADO, AGUARDANDO FATURAMENTO, FATURADO, NEGADO, DESCONHECIDO, CANCELADO, NÃO CONFIRMADO, AGUARDANDO LIBERAÇÃO.
