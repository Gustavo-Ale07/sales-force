# CHECKPOINT — 2026-11-05, parte 2e

Branch `feat/sales-force-evolution`. Base em staging: `8533819` (migrações 0026/0027 aplicadas, dry-run ligado). Nada ao Sankhya, nada em staging, sem deploy, produção intocada.

## Feito (commits publicados)

| Item | Commit | Resumo |
|---|---|---|
| 0 | `3ed8d7c` | Hook anti-heredoc. **Feche e reabra o Claude Code para valer.** |
| 1 L1 | `c907e92` | `INFORMARPRECO` como string simples |
| 2 M1 | `f2ed62b` | CLI `order-resend`: reenfileira pedido entregue com a mesma chave de idempotência |
| 3 M3 | `fd50823` | Orçamento de 40 requisições no worker (padrão 40 em modo live) |
| 4 D-V | `2439104` | Contagem por critério de elegibilidade (clientes, transportadoras) em log, `sync_state.cursor.lastRun.excluded` e saída do `sync-once` |
| 4 J2 | `ae214d2` | Produtos fora por mobilidade contados (`mobility: n`); rodapé do PDF "Emitido pelo Sales Force" (era literal de instalação) |
| 5a J3 | `e16b6a8` | Vocabulário orçamento/pedido no mobile |

Documentação: `docs/sankhya-spike.md` §9.51 atualizada (transportadoras e produtos agora reportados).

## NÃO feito — item 5b (conversão nativa `convert_quote`)

Adiado de propósito; **não implementado**. Desenho para a próxima rodada:
- Gateway: `readQuoteChildren` (TGFVAR por `NUNOTAORIG`) e `convertQuote` (real = recusa até validar; fake em `FakeOrderBook`), `SelecaoDocumentoSP.faturar` só depois de validado.
- Worker: operação `convert_quote` no outbox (sem colisão com `send_order`), atrás da mesma comporta de escrita, com registro de dry-run próprio.
- SNK-4: ler TGFVAR primeiro; se já existe filho, vincular em vez de converter.
- Pedido Force vinculado TOP 1001 com `erp_order_number` = novo NUNOTA; textos "Pedido nº M (do orçamento nº N)" e "Convertido em pedido nº M"; flags de divergência; testes.
- Hoje `convertQuote` (J3a) recusa orçamento já no Sankhya (`already_in_sankhya`).

## Resto do 5a
"Pedido nº" ainda aparece em `ui/sales-screen.tsx` e na tela de sucesso de `ui/new-order-screen.tsx` (sem flag de orçamento disponível ali; testes esperam "Pedido nº").

## Verificação
- sankhya 347/347; domain ok; server unit 531/531; mobile tsc limpo e jest 495/495.
- Suíte de integração completa do servidor: 1500/1503; 3 falhas, todas corrigidas e reexecutadas (12/12): migration-0008 (expectativa da última migração, agora 0027) e restricted-roles (force_api sem SELECT em integration_order_dry_run, regressão do D-Z; GRANT por coluna em db-roles.sql).
- ESLint **não rodou** (comando não encontrado).
- Playwright e2e (K7-adaptados) nunca rodados.

## Deslizes de processo (declarados)
Heredocs anteriores (e um `cat > /dev/null` sem efeito mais tarde) (corpos de commit, anexos de teste) e um no-op `cat > /dev/null <<'EOF'`; um `sed` global; uma suíte do servidor rodada com Docker parado; um `sed` que corrompeu regex `\b` (corrigido).

## Só o dono roda
Caminhos reais de staging: `/opt/force-staging/config/installation.json`, `deploy/scripts/sf-compose.sh`.
1. Copiar `.claude/work/PLAC_STAGING_INSTALLATION.json` (chave `customers.eligibility`) para `/opt/force-staging/config/installation.json` e rodar `config-bootstrap`.
2. `deploy/scripts/sf-compose.sh exec worker node dist/sync-once.js customers carriers products` e conferir a linha "left out by eligibility - criterion=n" (clientes: `active`, `flag:CLIENTE`, `column:CLASSIFICMS`; transportadoras: `active`, `flag:TRANSPORTADORA`; produtos: `mobility`). O valor `'R'` de CLASSIFICMS é hipótese a validar.
3. **`db-roles.sql` em staging é obrigatório**: o D-Z (já em staging) lê `integration_order_dry_run` pela API sem GRANT, o que dá 500 ao abrir/listar pedidos. A correção é um GRANT SELECT por coluna (order_id, created_at, payload_hash) para force_api; reexecute o arquivo (SF_RUN_DB_ROLES=1 no deploy).
4. Teste ao vivo nº 1 no Sandbox: só com sua autorização; deploy sem `-f` desliga o override.
