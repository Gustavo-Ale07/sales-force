# CHECKPOINT 2026-11-12 — cadastro de cliente, visibilidade de cliente e novos blocos do dono

Branch `feat/sales-force-evolution`. Nada publicado: sem push, sem deploy, sem flag ligada, sem escrita no Sankhya.

## FEITO (commitado)

| Hash | O quê |
|---|---|
| `e2b7a8e` | **Item 6** — o Force só mostra cliente com `ATIVO='S'` e `BLOQUEAR<>'S'` (app, site, cache do aparelho). Filtro "Situação" e cartões ativos/bloqueados removidos. Escrita de pedido de cliente oculto continua 409 `customer_ineligible` (`requireForOrder`). Contrato/OpenAPI regenerados. Decisões do dono sobre CODTIPPARC/CODREG/TIPOGERBOLETO/CLASSIFICMS registradas em D-AQ e no plano (B6). Corrigidos 2 defeitos antigos de teste (`sales-history-service.test.ts`: ownership do DEMO e regex `custo` casando `customerCode`). |
| `9c23a92` `9d89673` `c8d91a4` `b33b26c` | D-AQ corrigida (cliente sem mobilidade), F1 (CPF/CNPJ, chave de origem `AD_FORCEORIGEM`, lista de campos editáveis), D-AP/D-AR aprovadas, plano `docs/implementation/customer-write-plan.md` (F0–F10, T1–T9, bloqueios). |
| `d90a1c6` e anteriores (`3d7b9c8` … `7102308`) | Lote de OTA anterior (itens 1–7), lint web etc. |

Verificação do e2b7a8e: typecheck do monorepo verde (10 projetos); servidor unit 574/574; **integração completa 53 arquivos / 1.075 testes verdes** (rodada com `--no-file-parallelism`); web 601; mobile 552; mobile-db verde; lint web/servidor/mobile sem erros.

Causa das falhas de integração antes do commit: (a) 2 testes de `commercial-catalog` e 3 de `customer-ineligible` dependiam do filtro/contagens antigos (atualizados); (b) 5 de `sales-history-service` eram defeitos antigos do teste, não de memória nem de ambiente. Nenhum reinício de container foi necessário.

## FALTA (ordem sugerida)

### A. Bloco "Cadastro e edição de cliente" (plano: `docs/implementation/customer-write-plan.md`)
Um commit por fatia, tudo atrás de `SANKHYA_CUSTOMER_WRITE_ENABLED` (fechada por padrão, só o worker lê, só duplo do Sankhya nos testes):
- **F0** teste que fixa "transportadora obrigatória" (domínio já tem `missing_carrier` em `packages/domain/src/order-header.ts`; falta o teste de servidor/app/site que o fixe) — era o próximo passo.
- **F2** flag + validação de boot (Sandbox allowlist + modo explícito "sandbox"; nunca produção).
- **F3** contrato do gateway (`upsertPartner/findPartnerByOrigin/findPartnerByDocument`) + FakeGateway.
- **F4** migração só aditiva (permissões, colunas de origem/estado, `customer.upsert` no `integration_outbox`).
- **F5** API `POST/PATCH /customers` (permissões `customers.create`/`customers.update`, limite por hora, matriz de autorização).
- **F6** consumidor no worker + mapeador real (sem enviar CODTIPPARC/CODREG/TIPOGERBOLETO; CLASSIFICMS escolhida, R padrão; nunca LIMCRED).
- **F7** cliente pendente no app ("aguardando envio ao Sankhya").
- **F9** edição (telefone, e-mail, contatos, endereços, observações) com confirmação de conflito.
- **F8** formulário com etapa de endereço (só TSIEND/TSIBAI existentes), testar em 360x640 e 412x915.
- Pendente do dono: regra de IE por classificação (NEEDS VALIDATION); T3 de escrita no Sandbox exige AUTORIZO; ligar a flag em staging é decisão do dono.

### B. Novos blocos colados pelo dono (ainda NÃO iniciados)
1. **Mobilidade (`AD_MOBILIDADE`)** — produto, TOP, tipo de negociação, demais cadastros; trava anti-catálogo-vazio; produto que perde mobilidade em rascunho fica marcado e bloqueia envio. Depende dos valores distintos que o agente do Chrome vai trazer (não chutar). Mapa de uso atual: `mapping.ts`, `real-gateway.ts`, `mirror-scope.ts`, `configuration/sankhya-overlay.ts` (Q2/Q3/Q5/Q6/Q8), docs `sankhya-configuration-contract.md`, `decisions.md` ~793–804.
2. **Regra de produto por preço** — produto só aparece/é aceito com `ATIVO='S'`, `AD_MOBILIDADE='S'` e preço > 0 na tabela do cliente (CODTAB, senão tabela 5; catálogo sem cliente = 5). Remover filtro "Preço: Todos/Com preço/Sem preço". Guardar offline os preços de todas as tabelas usadas pelos clientes visíveis (levantar nº de tabelas, tamanho, tempo; propor alternativa sem cortar). Perguntas 3 e 4 (192 produtos de diferença) precisam de dados do Sandbox/staging.
3. **UX de sincronização (app)** — separar causas (sem internet / servidor do Force fora / Sankhya fora / tudo ok), chip "Offline"/"Atenção"/"Erro", estado atualiza na hora após sincronizar; testes das 5 combinações.
   - **Achado (item 1):** a linha "Conexão" (`ConnectivityBadge`) lê só o estado do SO (`expo-network`, `connectivity.ts`). O chip e a "Situação" (`apps/mobile/src/offline/sync-status-text.ts`) usam `connectivity==='offline' || status.phase==='offline'`; a fase `offline` é gravada por `packages/mobile-db/src/sync-manager.ts` (linhas ~106 e ~170) para qualquer erro de rede/API e fica presa até a próxima sincronização. Por isso "Online" convive com "Offline". O chip mostra "Erro" quando `needsAttention>0` (linha 20 de `sync-status-text.ts`).

### C. Pendências antigas
- Bloco "sem vendedor" no passo 1 do pedido; sincronização sob demanda.
- Relatório dos 8 problemas de borda em `packages/domain` (`billing-status.ts` 16 e 19, `entities.ts:94`, `erp-release.ts:2`, `money.ts:159`, `test/erp-release.test.ts:30`, `test/ipi.test.ts:46`, `test/money.test.ts:170`): propor reescrita neutra de comentários/títulos de teste, sem afrouxar a regra.
- O workflow de staging também dispara em push (corrigir a afirmação sobre CI vs VPS).

## Respostas de leitura já levantadas (relatório final)
- Diferença de 67 clientes: elegibilidade do PLAC é `CLASSIFICMS IN ('R')`; no Sandbox há 56 C + 8 X + 2 I = 66 não-R entre os ativos → 5.804 − 66 = 5.738 vs 5.737 mostrados (1 sem explicação). **Consequência:** cliente criado no Force com classificação ≠ R não apareceria no app; decisão do dono: alargar a elegibilidade ou restringir a escolha.

## NÃO verificado
Visual em aparelho/emulador (telas mobile); nenhuma escrita no Sandbox; "Sem transportadora" não foi encontrado em repo/docs; o arquivo de instalação `PLAC_STAGING_INSTALLATION.json` é local e o staging pode diferir; nada foi testado na VPS.

## Estado do working tree
Não mexer/commitar: `.claude/work/work/HANDOFF_2026-09-29.md` (modificado) e `apps/web/e2e/zz-shots.e2e.ts` (não rastreado) — não são deste trabalho.
