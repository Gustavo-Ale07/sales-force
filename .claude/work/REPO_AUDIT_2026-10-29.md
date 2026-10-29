# REPO_AUDIT_2026-10-29 — auditoria de repositórios (FASE 1, somente leitura)

Gerada em 2026-10-29 (Fase 1; executada na Fase 2 no mesmo dia, ver CURRENT.md). Nada foi apagado, movido, commitado ou enviado. Só rodei `git fetch --all` (sem `--prune`), que atualiza refs remotas locais. Nenhum arquivo de segredo foi aberto: só nomes.
Limites: **`gh` não está instalado nesta máquina** (nem no PATH do PowerShell, nem no Git Bash, nem em `Program Files\GitHub CLI`), então o quadro do GitHub vem só do que o `git fetch` mostra.

## 1. Veredito curto (confirma/corrige o CURRENT.md)

| Afirmação do CURRENT.md | Dado | Veredito |
|---|---|---|
| Fonte de verdade = `C:\Dev\sales-force-evolution` (`feat/sales-force-evolution`) | HEAD `17163e2` (28/10), 30 commits à frente de qualquer remoto | **Confirmado**, mas esses 30 commits existem **só neste PC** (nunca foram enviados ao GitHub) |
| evolution é um *worktree* de `C:\Dev\sales-force` | `C:\Dev\sales-force-evolution` tem **`.git` próprio (diretório)** e o remote `local-base` → `C:\Dev\sales-force`. Quem é worktree ligado de `C:\Dev\sales-force` é **`C:\Dev\sales-force-evolution-old`** (arquivo `.git`) | **Corrigido**: evolution já é independente. A dependência é a inversa |
| `C:\Dev\sales-force` só guarda a suíte Playwright `2a836a0` | Guarda também **8 arquivos `.claude/work` + `.claude/CLAUDE.MD` não rastreados e que não existem em nenhum outro lugar**, um `deploy/.env` (segredo, só nome) e 50 MB de histórico de conversas do Claude Code | **Corrigido**: há mais coisa única do que a suíte |
| D12 (cherry-pick de `2a836a0` no evolution) | `2a836a0` **não é ancestral** do HEAD do evolution e não há nenhum `e2e`/`playwright` em `git ls-tree HEAD` | **D12 NÃO feito** |

Metadado inconsistente: `C:\Dev\sales-force\.git\worktrees\sales-force-evolution\gitdir` aponta para `C:/Dev/sales-force-evolution/.git` (caminho que hoje é **outro** repositório). O worktree ligado real é o `-old`, que ficou registrado sob o nome antigo. `git worktree list` em `C:\Dev\sales-force` mostra `C:/Dev/sales-force-evolution f57b2f8`, o que é enganoso.

## 2. Tabela dos repositórios locais

Tamanhos em MB (total / sem node_modules). Só foram medidos com node_modules os checkouts do Força de Vendas.

| # | Caminho | Tipo | Remote | Branch atual | HEAD | Ahead/behind da branch atual | Não commitado | Stash | Commits só aqui (`--branches --not --remotes`) | Tamanho |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `C:\Dev\sales-force-evolution` | **principal** (`.git` dir) | `origin` = github Gustavo-Ale07/sales-force; `local-base` = `C:\Dev\sales-force` | `feat/sales-force-evolution` | `17163e2` 2026-10-28 "docs(work): checkpoint 2026-10-28, stop after D1" | **ahead 30** de `origin/feat/sales-force-evolution` (`e705f2f`) | limpo | 0 | **30** | 3.792 / 645 |
| 2 | `C:\Dev\sales-force` | **principal** (`.git` dir), hospeda o worktree `-old` | `origin` = mesmo GitHub | `feat/phase-0-foundation` | `2a836a0` 2026-10-28 "wip(web): Playwright E2E suite…" | ahead 13 de `origin/feat/phase-0-foundation` (`b12c5af`) | 9 não rastreados (ver §4) | 0 | **1** (`2a836a0`) | 648 / 20 |
| 3 | `C:\Dev\sales-force-evolution-old` | **worktree ligado** de #2 | `origin` = mesmo GitHub | `feat/sales-force-evolution` | `f57b2f8` 2026-10-01 "fix(mobile): bind drafts…" | sem upstream configurado; `f57b2f8` é ancestral do evolution | 2 não rastreados: `.claude/references/` e `.claude/work/`; ainda existem `.env` e `deploy/.env` (ignorados) | 0 | 1 (`2a836a0`, o mesmo de #2) | 2.420 / 926 |
| 4 | `C:\Users\T-GAMER\Desktop\sales-force` | **principal** (`.git` dir), clone antigo | `origin` = mesmo GitHub | `design/blueprint` | `b85dd48` 2026-09-16 "docs: record blueprint draft v0.1…" | **behind 3** (remoto em `b7a3f70`); `main` behind 9 | 9 arquivos **modificados**: `CLAUDE.md` e 8 `.claude/rules/*.md` | 0 | 0 | 11 / 11 |
| 5 | `C:\Dev\dbexplorer-omie` | principal | github Gustavo-Ale07/dbexplorer-omie | `main` | `23c0c85` 2026-10-16 | em dia | limpo | 0 | 0 | 11 |
| 6 | `C:\Dev\dbexplorer-sankhya` | principal, com 45 worktrees em `.claude/worktrees/` | github Gustavo-Ale07/db-sankhya | `backup/rodada-2-2026-10-21` | `8932c39` 2026-10-27 | — | limpo | 0 | **40** | 258 |
| 7 | `C:\Dev\smilo-office` | principal + 1 worktree em `AppData\Local\Temp\…\scratchpad\wt-main` | `git@github-smilo:Gustavo-Ale07/smilo-office.git` | `feat/job-hunter-paraguay` | `51964c1` 2026-10-26 | — | limpo | 0 | 0 | 85 |
| 8 | `C:\Dev\ti-plac` | principal | github Gustavo-Ale07/chamados-t.i. | `main` | `8257693` 2026-10-15 | em dia | limpo | 0 | 0 | 16 |

Nota: `C:\Users\T-GAMER\Desktop\Migracao-Recrutamento` e `Desktop\obs-archives` aparecem nas pastas do Claude Code, mas **não são repositórios git** nas raízes varridas (profundidade 3).

### Branches locais dos 4 checkouts do Força de Vendas

| Checkout | Branches locais (upstream, situação) |
|---|---|
| #1 evolution | `feat/sales-force-evolution` (origin, **ahead 30**), `feat/phase-0-foundation` (local-base, behind 1, `823eefa`) |
| #2 sales-force | `feat/phase-0-foundation` (ahead 13, `2a836a0`), `main` (behind 2), `design/blueprint` (em dia, `b7a3f70`), `feat/sales-force-evolution` (sem upstream, `f57b2f8`), `backup/pre-plac-visual-2026-09-25` (sem upstream, `beb251d`; o commit já está contido em outra branch publicada, só o nome local não existe no remoto) |
| #3 old | as mesmas 5 branches de #2 (repositório compartilhado) |
| #4 Desktop | `design/blueprint` (behind 3), `main` (behind 9) |

Refs remotas (`origin`, mesmas nos 4): `main` 2026-09-20 `6d08d99` · `design/blueprint` 2026-09-18 `b7a3f70` · `feat/phase-0-foundation` 2026-09-18 `b12c5af` · `feat/sales-force-evolution` **2026-10-08 `e705f2f`** · `fix/sankhya-username-login` 2026-10-02 `62f50b1`.

### Presença de arquivos de configuração/segredo (só nomes)

| Checkout | Encontrados |
|---|---|
| #1 evolution | `.env.example`, `deploy/.env.example`, `CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json`, `apps/mobile/eas.json`, `.claude/work/` (45 arquivos rastreados). **Sem `.env`, sem `compose.env`.** Não rastreia `debug.keystore` (0 arquivos) |
| #2 sales-force | `.env.example`, **`deploy/.env`**, `deploy/.env.example`, `CLAUDE.md`, `.claude/CLAUDE.MD`, `.claude/settings.json`, `.claude/settings.local.json`, `.visual-reference/.../CLAUDE.md`, `.claude/work/` |
| #3 old | **`.env`**, **`deploy/.env`**, `.env.example`, `deploy/.env.example`, `CLAUDE.md`, `.claude/settings*.json`, `apps/mobile/android/app/debug.keystore`, `.claude/work/`, `.claude/references/` |
| #4 Desktop | `CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json` |

Nenhum `*.pem` encontrado até profundidade 5. Nenhum `compose.env` em nenhum checkout (o do staging fica na VPS).

### Histórico de conversas do Claude Code (`C:\Users\T-GAMER\.claude\projects\`)

| Pasta | Arquivos | Tamanho | Observação |
|---|---|---|---|
| `C--Dev-sales-force-evolution` | 268 | 289 MB | histórico da fonte de verdade |
| `C--Dev-sales-force` | 34 | 50 MB | histórico das sessões de 2026-09 até esta (a sessão atual vive aqui) |
| `C--Users-T-GAMER-Desktop-sales-force` | 5 | 28 KB | |
| `C--Users-T-GAMER-Desktop-sales-force--claude` | 3 | 2,8 MB | |
| Demais | | | `dbexplorer-omie`, `dbexplorer-sankhya` (+26 pastas de worktrees de agentes), `smilo-office`, `ti-plac`, `Migracao-Recrutamento`, `obs-archives`, `System32` e 2 pastas de scratch: **fora do escopo** |

Arquivar uma pasta de código **não move** esse histórico. Ele é indexado pelo caminho antigo. Abrir sessões sempre em `C:\Dev\sales-force-evolution` é o que mantém o histórico novo num lugar só.

## 3. Grupos por URL de remote (Força de Vendas)

Todos apontam para `https://github.com/Gustavo-Ale07/sales-force.git`: **#1, #2, #3, #4**.
Mais atualizado: **#1** (`17163e2`). O que cada cópia tem de ÚNICO:

| Cópia | Único (não existe em #1 nem no GitHub) |
|---|---|
| **#1 evolution** | **30 commits** (tudo de AUTH-6, PB-1, DISC-2, STACK-2b, decisões D1–D12 e AUTH-9, checkpoints), desde `e705f2f`. **Só existem neste PC** |
| **#2 sales-force** | (a) commit `2a836a0` com a suíte Playwright (`apps/web/e2e/*`, 1.473 linhas); (b) **9 arquivos não rastreados** que não existem em #1: `.claude/CLAUDE.MD`, e em `.claude/work/`: `MOBILE_PLAN.md` (6 KB), `PAUSED_WORK.md` (17 KB), `SALES_FORCE_AUDIT.md` (28 KB), `SALES_FORCE_PLAN.md` (37 KB), `SALES_FORCE_PROGRESS.md` (83 KB), `VIDYA_GAPS.md` (13 KB), `VIDYA_PARITY.md` (20 KB), `VIDYA_SCREEN_SPECS.md` (18 KB); (c) `deploy/.env` (segredo, não aberto); (d) 50 MB de histórico de conversas |
| **#3 evolution-old** | `.claude/references/` com 19 arquivos não rastreados (o #1 rastreia 38; que os 19 sejam subconjunto **não foi comparado arquivo a arquivo**); `.claude/work/` com 9 itens (7 idênticos aos do #1; `CURRENT.md` e `auth-spike/sankhya-login-probe.mjs` são versões **mais antigas** que as do #1); `.env` e `deploy/.env` (segredos, não abertos); `debug.keystore`. Nenhum commit exclusivo além de `2a836a0` |
| **#4 Desktop** | 9 arquivos **modificados e não commitados**: `CLAUDE.md` (130+/76− contra `origin/design/blueprint`) e `.claude/rules/{backend,database,domain,frontend,mobile,sankhya,security,testing}.md`. Não é só quebra de linha (mesmo ignorando CR/espaços há diferença). Provavelmente são rascunhos de 09-16 já superados por versões mais novas no #1, mas **não comparei o conteúdo** → pendente do dono |

Grupos de outros projetos (um checkout por URL, sem cópias): `dbexplorer-omie`, `db-sankhya`, `smilo-office`, `chamados-t.i.`. **Fora do escopo desta auditoria**, sem recomendação.
Única observação factual, sem recomendação: `C:\Dev\dbexplorer-sankhya` tem 47 branches locais sem upstream e 40 commits que não estão em nenhum remoto.

## 4. D12 e a suíte Playwright

- `2a836a0` não está no evolution. Ele toca 21 arquivos: `apps/web/e2e/**` (13), `apps/web/{package.json,eslint.config.js,tsconfig.json}`, `package.json`, `pnpm-lock.yaml`, **`.claude/settings.json`** (remove a linha `Write(docs/blueprint.html)` das negações) e **`.claude/work/CURRENT.md`** (+300 linhas, versão antiga).
- Um cherry-pick cego **regrediria** o CURRENT.md do evolution e **enfraqueceria** uma negação de segurança. Deve levar só `apps/web/e2e/**` e as mudanças de `package.json`/lock/eslint/tsconfig do web.
- A suíte é pré-pivot: os testes fazem login de vendedor por senha, o que o AUTH-6/AUTH-9 tornou impossível. Migrar exige a escolha (a)/(b)/(c) pendente; recomendação: (c), sessão criada por fixture só de teste.

## 5. GitHub

`gh` ausente → **sem lista de repositórios, PRs abertos, proteção de `main` e `pushedAt`**. Pendente do dono (instalar/autenticar `gh`, ou colar a saída de `gh repo list` e `gh pr list`).
O que o `git fetch` mostra no repositório `Gustavo-Ale07/sales-force` (5 branches remotas, tabela em §2):

| Branch remota | Último commit | Tem checkout local? |
|---|---|---|
| `main` | 2026-09-20 `6d08d99` | #2, #3 (behind 2), #4 (behind 9) |
| `design/blueprint` | 2026-09-18 `b7a3f70` | #2, #3, #4 (behind 3) |
| `feat/phase-0-foundation` | 2026-09-18 `b12c5af` | #2, #3 (ahead 13), #1 (via `local-base`) |
| `feat/sales-force-evolution` | 2026-10-08 `e705f2f` | #1 (ahead 30), #2/#3 (`f57b2f8`, desatualizado) |
| `fix/sankhya-username-login` | 2026-10-02 `62f50b1` | **nenhum checkout local tem branch local** (mas `62f50b1` é ancestral do HEAD do evolution) |

## 6. Staging (somente leitura)

- Containers do Força de Vendas: `salesforce-staging-{web,api,worker,verifier,postgres}-1`, todos `healthy`, "Up 13 days". Imagem do servidor: `sales-force-server:e705f2f66cea`; web: `sales-force-web:e705f2f66cea`; banco `postgres:17`.
- Imagens presentes: `sales-force-server:e705f2f66cea` (937 MB) e `sales-force-server:62f50b18b4dc` (907 MB, a anterior).
- **SHA do staging = `e705f2f`** (2026-10-08), que é o topo de `origin/feat/sales-force-evolution`.
- Distância até o HEAD do evolution (`17163e2`): **30 commits atrás** (`git rev-list --count e705f2f..HEAD`).
- Migrations ainda não aplicadas lá: **`0012_sales_order_discount_authority.sql`** (e seu `meta/0012_snapshot.json` + entrada no `_journal.json`). É expand-only (coluna com default).
- Também estão fora de staging: AUTH-6 (vendedor nunca entra por senha local, mensagem de indisponibilidade), `AUTH_MODE=external`, DISC-2. O staging continua em `AUTH_MODE=local`.
- Outros containers na VPS (pre-apontamento, evolution_*, dbexplorer-*, db-sankhya-*, central-ti-plac-*, plac-*): outros projetos, não tocados.

## 7. Recomendações para as pastas do Força de Vendas

Regra fixa aplicada: repositório que hospeda o `.git` de um worktree em uso nunca é candidato a remoção.

### #1 `C:\Dev\sales-force-evolution` → **MANTER** (fonte única)
- Pré-condição para ser mesmo "única fonte": os 30 commits só existem aqui. **Recomendo `git push origin feat/sales-force-evolution`** (fast-forward de `e705f2f`; não força nada). Não fiz push (decisão sua; a regra desta sessão é sem push até você dizer).
- Remover o remote `local-base` (aponta para `C:\Dev\sales-force`) quando #2 for arquivado; é só config local.

### #2 `C:\Dev\sales-force` → **NÃO REMOVER AGORA** (hospeda o `.git` do worktree #3). Caminho para ARQUIVAR depois
Condições, nesta ordem:
1. **D12**: levar `apps/web/e2e/**` + `package.json`/lock/eslint/tsconfig de `2a836a0` para o evolution (sem `.claude/settings.json` nem `CURRENT.md`) e commitar. Depois `2a836a0` pode ser dado como contido.
2. **Os 8 arquivos únicos de `.claude/work/` + `.claude/CLAUDE.MD`**: decidir (a) copiar para o evolution (por exemplo `.claude/work/legacy-2026-09/`) e commitar, ou (b) arquivar só em `C:\Dev\_arquivo\`. Se for (a), `PAUSED_WORK` e `SALES_FORCE_PROGRESS` (83 KB) valem a leitura antes. O `.claude/CLAUDE.MD` é o que manda "ler CURRENT.md…" e hoje só existe aqui (o evolution tem `.claude/CLAUDE.md`? **não tem nenhum `.claude/CLAUDE.*`**).
3. **#3 arquivado antes** (abaixo), seguido de `git worktree prune` em #2 (ou apagar `.git/worktrees/sales-force-evolution`) para limpar o registro obsoleto.
4. **`deploy/.env`**: você decide se o conteúdo precisa ser levado (não abri); ele não vai para o evolution nem para git.
5. Remote: todos os commits de #2 estão no GitHub exceto `2a836a0` (item 1). Perderia só nomes de branch local.
6. Depois disso → **ARQUIVAR** para `C:\Dev\_arquivo\sales-force-20261029`. **Não** APAGAR: contém `deploy/.env` e 50 MB de histórico associado.

### #3 `C:\Dev\sales-force-evolution-old` → **ARQUIVAR** (nunca apagar sem sua ordem escrita)
Pré-condições:
- Sem alterações em arquivos rastreados (verificado: só `.claude/references/` e `.claude/work/` não rastreados).
- `f57b2f8` já é ancestral do evolution (verificado) → nenhum commit se perde.
- `.env` e `deploy/.env` (segredos): você decide se algo deles precisa ser copiado. Não abri.
- Os 19 arquivos de `.claude/references/` — **pendente** confirmar que são subconjunto dos 38 rastreados no evolution.
- É o worktree ligado de #2: ao mover, registrar em #2 e rodar `git worktree prune` (§7 #2, passo 3).

### #4 `C:\Users\T-GAMER\Desktop\sales-force` → **ARQUIVAR** (depende de você comparar 9 arquivos)
- Nenhum commit local exclusivo, atrás do remoto em tudo.
- Perda possível: 9 arquivos modificados (`CLAUDE.md` + 8 regras) que **não** estão no GitHub. Lista para decidir: salvar um `git diff` em `_arquivo` (minha sugestão) ou aprovar a perda por escrito.
- Não hospeda worktree nenhum.

### Pasta de histórico do Claude Code
Não faz parte do pedido de arquivamento de código. Se #2 e #4 forem arquivadas, as pastas `C--Dev-sales-force` e `C--Users-T-GAMER-Desktop-sales-force*` em `.claude\projects\` ficam órfãs mas seguras. **Pendente do dono:** manter ou arquivar também.

## 8. Pendente do dono (sem perguntas ao vivo, como pedido)

1. Push dos 30 commits do evolution para `origin/feat/sales-force-evolution`? (sem ele, o único backup é o disco deste PC.)
2. Destino dos 8 arquivos `.claude/work` únicos e do `.claude/CLAUDE.MD` de #2 (copiar para o evolution ou só arquivar).
3. Diferenças dos 9 arquivos modificados no #4.
4. Conteúdo de `.env`/`deploy/.env` em #2 e #3 (precisa ser levado?).
5. `gh` instalado/autenticado ou saída colada, para fechar o quadro do GitHub (PRs, proteção).
6. Os 19 arquivos `.claude/references/` do #3 versus os 38 do #1.
7. Pasta de histórico do Claude Code: manter ou arquivar.
8. Registro: as decisões D1–D12 (`02415be`, §3.14 de `docs/decisions.md`) foram commitadas por um subagente. **Eu não vi a aprovação** delas nesta conversa; você precisa confirmar que são suas e que o texto está fiel (ver minha mensagem anterior).
9. Estas pastas dos outros projetos ficaram só no inventário: `dbexplorer-omie`, `dbexplorer-sankhya` (47 branches sem upstream, 40 commits só locais), `smilo-office`, `ti-plac`.

## 9. Resposta pasta por pasta que espero

| Pasta | MANTER / ARQUIVAR / APAGAR |
|---|---|
| `C:\Dev\sales-force-evolution` | recomendado **MANTER** |
| `C:\Dev\sales-force` | recomendado **ARQUIVAR depois dos passos 1–4** (nunca APAGAR) |
| `C:\Dev\sales-force-evolution-old` | recomendado **ARQUIVAR** |
| `C:\Users\T-GAMER\Desktop\sales-force` | recomendado **ARQUIVAR** após seu OK sobre os 9 arquivos |
