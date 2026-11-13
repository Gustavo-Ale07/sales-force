# CHECKPOINT 2026-11-13 — fechamento do release 1 (sem push, sem deploy, sem escrita no Sankhya)

Branch `feat/sales-force-evolution`. Tudo abaixo está commitado e NÃO enviado (push só com ordem do dono). Arquivos do dono que nunca se commitam: `.claude/work/work/HANDOFF_2026-09-29.md` (modificado), `apps/web/e2e/zz-shots.e2e.ts`, `.claude/work/CURRENT.md.bak`.

## Feito neste ciclo (hashes)
- Cadastro de cliente (D-AR): 04771ba, f1c2c60, 9a1f0f9, e7b865c, 44cf494, 857adc9, dc39f98; migração 0039 (outbox/guardas) a55e05d.
- Preço/sync/pedidos: f6bb380, 49fe56a, 0bbbf6d (GET /price-tables/{code}/prices), 08d3460, 7afadf6 (GET /orders?ids=), ae380f9, 471b3f8, 1899892 (tabela 5 no PLAC staging), 4fc80e6, 0cb755c, 4d0e8ea, d1f42a6, 7aacb9c; escopo do endpoint de preços ao escopo de quem pede: 1aa903a.
- Mobile: 3d88544, 62f065a, 21d9a50, 134afbe, 7d628be, a63422b, 6d1d7a3. Web: cf1fd22.
- Domain: 58a8800 (comentários neutros; ver "Fora do plano").

## Respostas do dono (13/11/2026, itens 1–9) — para o release 2
1. Criar no servidor um código de erro DISTINTO de conta desativada/sessão revogada (contrato + OpenAPI), diferente do 401 de sessão expirada. Não esperar o AUTH-2.
2. Wipe na revogação: apagar TUDO, inclusive pedidos não enviados; acionar SOMENTE com esse código, nunca num 401 comum; ligar o gatilho no app. Testes: 401 comum não apaga; código de revogação apaga. V-09 (SQLCipher) segue risco aberto e BLOQUEANTE para produção. (`wipeAll()`/`wipeLocalDatabase` já existem e estão testados, a63422b; falta o gatilho.)
3. Detalhe do pedido no app: "Situação no Sankhya: {rótulo do servidor}" + "atualizado em dd/mm hh:mm (última sincronização)". Ajustar a regra de `apps/mobile/src/offline/sales-status.ts` (hoje nenhum rótulo afirma estágio do ERP, porque o aparelho não tinha o estágio; agora o status é baixado — 6d1d7a3 — e a UI ainda não o mostra). Sem afirmar tempo real.
4. Preço de lista para todo perfil comercial aceito, desde que o endpoint só devolva tabelas usadas por clientes no escopo de quem pede (outras: 404) e nunca custo/margem — FEITO em 1aa903a (nota de segurança LOW: varredura distinta por página; avaliar cache/EXISTS se houver abuso).
5. 409 `idempotency_conflict` em reenvio após 30 dias aceito; o app trata como "Pedido antigo, refaça" (falta no app).
6. `check-boundaries` do domain: comentários neutros SÓ onde é texto de comentário; dependência real no código se corrige no código. Contagem encontrada: 8 de 8 eram comentário/título de teste, 0 dependência real em código (58a8800).
7. Site: bloquear também o link direto e a pré-seleção `?customer=` de cliente sem vendedor no "Novo pedido" (falta; trabalho parcial salvo em `scratchpad/release2-partial.patch`).
8. Interpretações do agente mobile aceitas: cliente com tabela nula usa a tabela base 5; cliente confirmado apaga também o documento mascarado; "Produto inativo"/"Produto indisponível" só quando o servidor envia. Botão "Refazer" será ligado na F8.
9. `AD_MOBILIDADE` preenchido em produção (TOPs, tipos de negociação, produtos): requisito PRÉ-PRODUÇÃO, tarefa do dono.

## Fica para o release 2 (por ordem do dono)
Sinal de revogação + wipe ligado; status do ERP no detalhe do pedido; bloqueio do link direto/pré-seleção no site; "Pedido antigo, refaça" no 409; adaptador real de parceiro (CNPJ 13/14 dígitos, upsertPartner/findPartnerByOrigin/findPartnerByDocument/readWrittenPartner, selo "Sem vendedor"); F8 (inclui "Refazer"); F9 (PATCH /customers/{code}, `updateCustomer` em `ROUTE_POLICY`); F10 opcional.
Outros pendentes: remover campos mortos `productWithoutPrice.visible/.orderable` depois que todos os aparelhos atualizarem; logger do worker na retenção (hoje stderr); tabela `AD_MOBILIDADE` onde-usado de TGFLOC/TGFNAT/TGFNTA/TSIEMP (NEEDS VALIDATION); medir leitura real do Sankhya; `docs/sankhya-spike.md` §9.59; nota CLASSIFICMS em decisions.md/sankhya-spike.md; "CI vs VPS" statement; aplicar `db-roles.sql` e migrações 0036–0039 no staging (manual); papéis confirmados `force_api` e `force_worker` (gatilho 0039 usa `force_api`); revisar contra injeção o adaptador real (M-3).

## Bloqueios de produção
V-09 (criptografia local/SQLCipher) e o wipe na revogação (juntos); `AD_MOBILIDADE` em produção; SQLCipher nunca exercitado (testes só em node:sqlite).

## Não verificado
Visual/aparelho/iOS/Maestro; nada lido nem escrito no Sankhya real; staging real e `force_worker` real de ponta a ponta; migrações v8/v9 do mobile só em node:sqlite; `/sync/refresh` e pull por tabela só com fakes; consultas Sankhya alteradas nunca executadas.

## Sandbox (SELECTs I e J)
Pendentes: a aba do Sandbox pediu login; nada foi consultado nem digitado. Retomar quando o dono logar (só SELECT, contagens e códigos).
