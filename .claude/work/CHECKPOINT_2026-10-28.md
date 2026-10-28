# CHECKPOINT 2026-10-28 (encerrado a pedido do dono)

Worktree `C:\Dev\sales-force-evolution`, branch `feat/sales-force-evolution`. Só commits locais, nenhum push.

## Feito nesta sessão (commits)
- AUTH-6 completo: `4719d39`, `b18677d`, `c52f224`, `9f3521d`, `b9e962a` (domínio `user_blocked` + gancho `DirectoryBlockSource` sem coluna inventada; mirror velho/falha nunca revoga; login novo indisponível = 503 distinto; vendedor sem senha local).
- `02415be` registra D1-D12 em `docs/decisions.md` §3.14 (AUTH-9..12, MOB-6a, CFG-7, SEC-2, DISC-3/4, SNK-7/8, TEST-1).
- `28b1ceb` D1 / AUTH-9: seed cria vendedores demo sem senha utilizável (`createPasswordlessAccount`); CLI `create` e `set-password` recusam vendedor em qualquer AUTH_MODE. Testes de `operator-cli` 18/18 verdes.
- Por outro run: PB-1 (`c0168c2`, `b972431`, `e03fa45`) e DISC-2 base (`e847c54`, `2d2bf29`, `f65c9ca`, `1174453`).

## Não feito (ordem do dono, retomar nesta sequência)
0. Listar em CURRENT.md o que falta para 100% do blueprint (ler `docs/blueprint/parts/`, nunca `blueprint.html`).
1. security-reviewer em `4719d39..1174453` (precisa do orquestrador; corrigir alto/médio antes de tudo).
2. D2 (AUTH-10): em `AuthService.automaticLinkHolds` remover o filtro `VERIFIED_AUTO_PROVISION`; vale para todo vínculo `sankhya_auto`, manual intocado. Teste novo em `auth-username-hybrid.test.ts` com `linkMode` PRE_LINKED + vínculo `source='sankhya_auto'` + espelho fresco sem CODVEND => sessão revogada. Documentar em `docs/implementation/auth-username-flow.md`. (Nenhuma edição de D2 foi feita ainda.)
   D3 (AUTH-11): erro de banco na reavaliação mantém a sessão e loga/audita `link_reevaluation_error` sem PII + contador (não há infra de métricas no repo; usar campo de log estável `metric`); login novo com erro de banco segue recusado. D4 (AUTH-12): teste explícito de que username de vendedor local vai ao verificador e 401 uniforme.
3. D6 (CFG-7) subconjunto seguro de `GET /configuration` para vendedor + teste sem segredo/custo/margem; D7 (SEC-2) CSP: `style-src 'unsafe-inline'` só se não houver nonce, `script-src` estrito.
4. DISC-2 restante (D8/D9): limites por nível editáveis (padrão 5 e 15, "ajustar pelo dono"), tela admin, fluxo de aprovação web e mobile, auditoria; security-reviewer.
5. D12 (TEST-1): migrar E2E Playwright `2a836a0` (cherry-pick do checkout antigo) trocando login de vendedor pela fixture de sessão via API de teste; rodar suíte inteira.
6. Slice mobile offline (rascunho, cache, outbox, sync; `docs/mobile-spike.md`, MOB-6); security-reviewer.
7. D10 (SNK-7): plano em slices, depois envio de pedido só no Sandbox, flag `SANKHYA_ORDER_WRITE_ENABLED` desligada, allow-list de host, idempotência por pedido, dry-run documentado.
8. D11 (SNK-8) só plano, a menos que o blueprint exija. 9-10. Itens do passo 0 e lista final de lacunas. 11. Checkpoint final.

## Estado verificado
Antes de D1: domain 296, server 1127, web 421, mobile 426 verdes; typecheck e lint limpos. Após D1 só `operator-cli.test.ts` foi rodado (18/18); suíte inteira, typecheck e lint ainda por rodar após `28b1ceb`.

## Só o dono roda
Nada novo nesta sessão. Pendência do dono: campo de bloqueio de TSIUSU (NEEDS VALIDATION, gancho continua stub). Staging e Sandbox: nenhuma flag nova ligada.

## Decisões do dono
Apenas o campo de bloqueio de TSIUSU; D1-D12 já decididas.
