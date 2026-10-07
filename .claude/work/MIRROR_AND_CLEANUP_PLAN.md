# Plano executável — mirror real + limpeza transacional do DEV (NADA EXECUTADO)

Fonte: Sankhya TESTE (somente leitura). Sem escrita Sankhya, sem produção, sem push/merge.

## A. Volumes reais (TESTE, 2026-09-30) — apenas números conferidos
- Produtos V/R ativos: 1689, todos com grupo; com preço na tabela 5: 1502.
- Carteiras: vendedor 76 → 1 cliente; 6 → 111 (111 ativos); 72 → 336 (335 ativos). 799 clientes com CODVEND=0 (fora).
- Versões de preço vigentes: tabela 0→8, 3→6, 5→13, 6→12, 9→10 (0 linhas).
- **Totais de clientes, vendedores, grupos e TSIUSU NÃO estão fixados**: recontar no ensaio (C, S12) por consulta read-only antes de virarem critério de aceite.

## B. Pré-requisitos de código (estado local; nada executado contra Sankhya/DEV)
| # | Item | Estado |
|---|---|---|
| 1 | `readProductGroups` real (TGFGRU; código 0 excluído; sentinela raiz → pai null; sem IMAGEM) | FEITO, testado com ERP simulado |
| 2 | `readPriceTables` real (TGFNTA), tabelas vindas da config (`pricing.mobilePriceTableCodes`) | FEITO, testado |
| 3 | Versão vigente por tabela (maior DTVIGOR ≤ hoje + futuras); preços só das versões retidas; preço ≤ 0 nunca vendável; ausência ≠ 0 | FEITO (gateway real e fake) |
| 4 | Filtros de produto da config (CODPROD>0, ATIVO, `sellableUsageValues`); mobilidade configurável (modo `disabled`, leitura do campo não ativada, não persistida) | FEITO parcial — persistência do código de mobilidade precisa de expand migration (não feita) |
| 5 | Schema de configuração estendido (opcional): empresa padrão, TOPs elegíveis, local, layout, tabelas móveis, filtro de mobilidade, tabela alternativa (inativa) | FEITO; CFG-1 é PROPOSED → revisão do owner |
| 6 | `SYNC_MIRROR_ENABLED` repassado pelo compose (vazio = default do worker) e `false` no `deploy/.env` | FEITO |
| 7 | Proteção estrutural de pedidos legados (proveniência `dataset_origin`/`erp_environment` + CHECK + triggers, migration 0005) | Preparado e testado em Testcontainers; NÃO aplicado no DEV; aguarda aprovação |
| 8 | SankhyaUser: leitura TSIUSU (CODUSU, NOMEUSU, CODVEND; nunca INTERNO/hash/ACCOUNT*) | PENDENTE; campo ativo/bloqueio não validado |
| 9 | Identidade do ambiente ERP da instalação (valores de `erp_environment`) | PENDENTE decisão do owner |

## C. Ensaio em banco descartável (sem tocar o DEV)
1. Postgres descartável local (mesma major), aplicar migrations.
2. Live local: `SANKHYA_MODE=live`, `SYNC_MIRROR_ENABLED=false`, sync manual `sync:once`, escrita Sankhya desabilitada, outbox vazio.
3. Conferir contagens da seção A (S12) e amostras (S13): clientes 1/111/336 por carteira, placeholders 0 ausentes, produtos S/3 fora, "Sem preço" intacto.
4. Só então repetir no DEV.

## D. Provisionamento de contas reais
- Fonte: TSIUSU.CODVEND → TGFVEN (e-mail canônico TGFVEN.EMAIL). Sem vendedor → NO_SELLER_SCOPE (nunca escopo total). Vendedor com mais de um usuário TSIUSU → AMBIGUOUS_USER (recontar em C).
- Login único "Usuário ou e-mail" (mapeamento e-mail→TSIUSU, sem fuzzy). Senha: Force próprio (P-11) até decisão de auth. **Pendente:** como a primeira senha é entregue — não definido.
- `accountSellerLinks` da config recebe e-mail+sellerCode (PII; só arquivo de config do ambiente, não versionado).
- Contas demo (4): `status='disabled'`, não apagar (FK audit_log/sales_order).

## E. Limpeza transacional (somente após C concluído e aprovação do owner)
Pré: (1) `pg_dump` do DEV para pasta git-ignored + restauração testada em banco descartável; (2) API e worker parados; (3) integration_outbox = 0; (4) `SELECT status, count(*) FROM sales_order GROUP BY 1` — a migration 0005 falha (rollback atômico) se algum pedido estiver fora de draft/cancelled.

Transação única (ROLLBACK em qualquer asserção falha):
1. `session`: revogar sessões demo (contar antes).
2. `account` demo (4): `status='disabled'`, `password_hash` inutilizado; contas reais criadas em D. Nada apagado.
3. `sales_order` 1–8 (+itens): ficam como `legacy_dev` por **proveniência** (migration 0005; default da coluna), não por novo status; nunca enfileirar; não associar a clientes/produtos reais.
4. Mirror demo: DELETE em erp_list_price, erp_price_table_version, erp_price_table, erp_product, erp_customer, erp_seller (sem FKs de entrada); `sync_state` reiniciado para snapshot completo.
5. `installation_configuration_version`: inserir NOVA versão real e virar `is_current`; demo-1 permanece intacto (FK), apenas deixa de ser corrente.
6. `audit_log`: intocado; acrescentar evento de limpeza.
7. Asserções: nenhum registro "(demonstração)"; outbox=0; contagens reais conforme A; COMMIT.
Pós: primeiro sync manual real; dispositivos fazem dataset reset (validar que o cache SQLCipher limpa tudo do usuário anterior); análise de vazamento de cache multiusuário antes de liberar login real.
