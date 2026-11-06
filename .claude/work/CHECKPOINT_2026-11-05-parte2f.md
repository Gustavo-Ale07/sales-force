# CHECKPOINT — parte 2f (D-AA: salvar = enviar) — 2026-11-05/06

Branch `feat/sales-force-evolution`. Decisão registrada: `docs/decisions.md` D-AA.

## Commits (todos fast-forward, testes verdes antes de cada push)
- `72b6eaf` A1 — um botão "Salvar pedido/orçamento" que grava e envia (mesma chave de idempotência); "Enviar ao Sankhya" removido.
- `8334caf`, `2d34464` A2 — "fila" some de telas/PDF/mensagens; "Enviando ao Sankhya…" e, após 2 min, "Aguardando envio — será reenviado automaticamente".
- `3a79fc5`, `c2bdb89` A2/A4 — Reenviar após falha terminal (mesma linha de outbox e origin id; passa pelas mesmas checagens do primeiro envio); orçamento mostra "CONVERTIDO EM PEDIDO nº M" (`convertedInto`).

## A3 — travas de aprovação (auditoria, nada removido)
- Modo `erp` (padrão): nenhuma trava da Force no envio; o Sankhya decide (D-M) e o motivo de liberação aparece (D-P).
- Modo `force`: mantém aprovação (P-10, invariante). Fica como configuração opt-in. Nenhum código removido.

## A4 — orçamento
- Já existia: converter em lugar para orçamento nunca enviado (D-U a) e "Duplicar como pedido" (novo pedido com TOP de pedido, mesmos itens). Para orçamento já enviado esse é o interim.
- LIMITAÇÃO: sem vínculo TGFVAR no Sankhya. Faturar nativo (J3 b) segue NEEDS VALIDATION.
- Não verificado nesta rodada: se o envio de orçamento usa `incluirNota` sem `confirmarNota` (comportamento anterior D-A..D-L, não alterado).

## A5 — impacto no mobile (para a parte 3)
- Mobile ainda tem "Enviar" separado e o rótulo "Na fila"? Não verificado a fundo: `grep -rn "fila" apps/mobile/src` não achou em rodada anterior; revisar vocabulário Confirmar (D-AB) e o estado 2 min.
- Mobile precisa do novo campo opcional `convertedInto` e do reenvio via `submit` em pedido `rejected`.

## Verificação
- domain, web (499), server unit (531), integração `order-enqueue`/`order-approval-states`/`commercial-orders` (81) verdes. `tsc` limpo.
- NÃO rodados: ESLint (comando indisponível), Playwright e2e (nunca rodou), suíte completa de integração do servidor desta rodada.

## Deslizes de processo
- Dois `cat > /dev/null` sem efeito e uma tentativa com heredoc (bloqueada pelo hook).
- Docker Desktop estava parado; iniciei o aplicativo para rodar a integração.
