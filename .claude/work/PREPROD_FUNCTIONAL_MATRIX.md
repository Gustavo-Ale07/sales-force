# PREPROD_FUNCTIONAL_MATRIX (trabalho — não commitar) — 2026-10-01

Base: VIDYA_PARITY_MATRIX.md (2026-09-30), teste físico M55, snapshot HEAD 49740de. Sem evidência nova do Sankhya nesta sessão (sem credenciais) → nada promovido a VALIDATED sem prova.
Colunas: FUNCIONALIDADE | VIDYA/SANKHYA | WEB | MOBILE | OFFLINE | BACKEND | STATUS | EVIDÊNCIA | AÇÃO

| Funcionalidade | Vidya/Sankhya | Web | Mobile | Offline | Backend | STATUS | Evidência | Ação |
|---|---|---|---|---|---|---|---|---|
| Login operacional (user/senha Sankhya) | TSIUSU; MobileLoginSP.login → CORE_E01434 | demo only | demo only | n/a | conta Force própria | BLOCKED | probe auth-spike; matriz Vidya | Credenciais TESTE no ambiente ou saída do probe; decidir mecanismo (Sankhya ID?) |
| Login admin/técnico | — | Force próprio | — | — | Argon2id, sessão | FORCE_IMPLEMENTED | testes server | Manter; remover contas demo só após auth real |
| Usuário→vendedor | TSIUSU.CODVEND→TGFVEN.CODVEND (F-33/F-34) | via conta | via conta | sim | provisionamento | FORCE_PARTIAL | spike F-33/34 | Resolver no login; NO_SELLER_SCOPE; ativo/bloqueio TSIUSU PENDING_VALIDATION |
| Carteira | TGFPAR.CODVEND | ok | ok | ok | policy server | FORCE_IMPLEMENTED | QA 76→1, 6→111, 72→336 | Reconfirmar com login real |
| Clientes (lista/busca/detalhe) | TGFPAR | ok | ok | cache ok (busca offline não provada) | mirror 5851 | FORCE_IMPLEMENTED | teste M55 | Provar busca offline |
| Cidade/UF/endereço | TGFPAR | parcial | parcial | — | erp_customer city/state | PENDING_VALIDATION | colunas existem | Auditar endereço/contatos |
| Produtos (V/R, ativo) | TGFPRO | ok | ok | ok | mirror 1689 | FORCE_IMPLEMENTED | M55 | — |
| Grupos | TGFGRU, raiz -999999999 | ? | ? | ? | readProductGroups | FORCE_PARTIAL | matriz Vidya | Auditar árvore/ciclo/CODGRUPAI=0 |
| Imagens | fonte desconhecida | não | não | não | inexistente | BLOCKED | spike L706 "no image column" | Consultar dicionário TESTE (TGFPRO/anexos) — requer credenciais |
| Tabelas/preço atual | TGFNTA/TGFEXC | ok | "Sem preço" no catálogo (sem tabela ref.) | ok | versões 0,3,5,6,9 | FORCE_IMPLEMENTED | M55 | Decisão owner: preço de referência no catálogo |
| Preço zero/ausente/negativo | — | Sem preço | Sem preço | ok | fail closed | FORCE_IMPLEMENTED | commit e7e113a | — |
| CODTABALT=5 | — | — | — | — | inativo | PENDING_VALIDATION | matriz | Não usar |
| Promoções | TGFDES vazia | — | — | — | — | NOT_USED_BY_PLAC | matriz | Reconfirmar |
| Descontos por item | DISC-1 0–99,99% | ok | ok | ok | revalida | FORCE_IMPLEMENTED | decisions DISC-1 | Autoridade R35–R37 UNDECIDED |
| Cabeçalho/itens/carrinho | TGFCAB/ITE | ok | ok | rascunho local | idempotente | FORCE_IMPLEMENTED | testes | Auditar defaults fake (§18) |
| TOP / empresa / local / layout | 1001 / 1 / 209 / 30 | config | config | cache config | consome | FORCE_IMPLEMENTED (consumer pendente parcial) | matriz | Revalidar no TESTE (requer credenciais) |
| Negociação / transportadora | TGFTPV; CODPARCTRANSP | ? | ? | — | — | PENDING_VALIDATION | matriz | Definir se PLAC usa |
| Orçamento | — | ? | ? | — | — | PENDING_VALIDATION | — | Confirmar uso |
| Duplicar / repeat-last / templates | — | ok | ? | ? | guard dataset | FORCE_PARTIAL | order-templates-card; commercial-app guards | Auditar mobile; template create sem guard |
| Histórico | — | ? | ? | — | — | PENDING_VALIDATION | — | Gap até dados reais |
| Status ERP vs sync | GETCODSTATUS_VIDYA 0–6,-1 | parcial | parcial | — | derivação | FORCE_PARTIAL | matriz | Consumer pendente |
| Sync / idempotência / conflitos / needs_review | — | — | ok | ok | ok | FORCE_IMPLEMENTED | testes + M55 | Testes de confiabilidade §37 |
| Descarte | DraftDiscardError | — | só local não enviado | — | — | FORCE_PARTIAL | order-sync.ts:598 | Definir semântica arquivar/cancelar |
| Drafts legados (3) | — | — | ocultos, só contador | — | — | FORCE_PARTIAL | M55 | UX de quarentena inexistente — decisão owner |
| Dataset/ambiente | — | ok | ok | ok | guard + CHECK 0005 | FORCE_IMPLEMENTED | eaf46ae | Dívida: id manual PROPOSED |
| Permissões / perfil / logout / revogação | — | ok | ok | wipe | policy | FORCE_IMPLEMENTED | testes | Reprovar com perfis reais pós-auth |
| Atualização do dataset / do app | — | — | APK debug-key | — | — | FORCE_PARTIAL | build standalone | Keystore própria, HTTPS |
| Writer Sankhya | — | — | — | — | outbox | BLOCKED (SNK-6) | decisions | Sem escrita; gates V-11/V-13 |
| Performance, agenda, engajamento, mural | AD_TVDY* | — | — | — | — | NOT_USED_BY_PLAC (a confirmar) | matriz | Não implementar |

## Varredura fake/placeholder (§39), código não-teste
- `192.168.x` em `apps/mobile/App.tsx:19`, `src/config.ts:8`: só texto de ajuda/comentário → legítima.
- `localhost/127.0.0.1` em compose dev, README, env/config server, vite: dev-only (`api-env.ts` etc. — verificar que prod não cai nesses defaults).
- `demo`/`fake`: `packages/sankhya/src/fake/*`, `seed.ts`, `test-doubles.ts` → dev/test-only; `SANKHYA_MODE` default `fake` em `docker-compose.dev.yml:128` (dev-only). Dashboard: `demo:false` no server, selo "Dados de demonstração" só quando demo=true.
- Vendedores 101/103/107: nenhuma ocorrência em código não-teste.
- Pendente: confirmar que `seed.ts` e contas demo não são alcançáveis em perfil staging/produção.
