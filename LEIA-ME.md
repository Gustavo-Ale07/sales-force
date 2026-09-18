# Sales Force — configuração enxuta do Claude Code

Pacote completo e enxuto do Sales Force. Os documentos funcionais em `docs/*.md` permanecem intactos. As skills vendor já existentes não foram editadas; foi adicionada somente a skill upstream `grilling`, dependência exigida por `grill-me`, com a respectiva entrada em `skills-lock.json`. A configuração, os agents/rules e a forma de guardar o blueprint foram ajustados.

## 1. Como aplicar

Este zip é a pasta `sales-force` **completa** no estado final: tudo o que já existia (docs, 20 skills, `skills-lock.json`, `.gitignore`, `settings.local.json`, o `blueprint.html`) mais o que mudou. Só não vem o `.git`, que é o seu histórico local.

1. Extraia o zip e copie a pasta `sales-force/` **por cima** da sua (aceite sobrescrever tudo). Como o pacote não remove nenhum arquivo, o resultado é exatamente o estado final — e o seu `.git` fica intacto.
2. Abra um terminal na raiz do repositório e rode:
   ```
   node docs/blueprint/build.mjs --check
   ```
   Tem que sair `blueprint.html: up to date … no problems found`. Isso prova que as 246 partes remontam o `docs/blueprint.html` byte a byte (conferido por sha256 aqui: `f85cc9448a3c…`).
   Se você editou o `blueprint.html` **depois** de gerar o .rar, o zip terá sobrescrito sua versão com a antiga: recupere a sua com `git checkout -- docs/blueprint.html` (ou do seu backup) e me manda o arquivo, que eu refaço a divisão.
3. Commit (você é o owner, então está autorizado):
   ```
   git add -A
   git commit -m "chore: finalize token-efficient Claude Code configuration"
   ```

## 2. Trocar o modelo

- **Já está feito por padrão:** `.claude/settings.json` agora tem `"model": "sonnet"`. Toda sessão aberta na raiz do projeto começa em Sonnet, e os 9 agents têm `model: sonnet` no frontmatter.
- Para conferir dentro do Claude Code: `/model` (mostra o atual e deixa escolher).
- Quando precisar de Opus numa rodada de decisão: `/model opus` — e volte com `/model sonnet` ao terminar. Também dá para abrir direto: `claude --model opus`.
- Evite as variantes `[1m]`; contexto grande sem compactação foi parte do problema.

## 3. Rotina por sessão (o que mais economiza)

1. `claude` na raiz do repo → `/context` uma vez, para ver o que está carregado (deve ser bem menor que antes).
2. Um lote de design por sessão. Terminou e commitou → `/clear`.
3. Vai sair por um tempo → `/compact` antes.
4. Blueprint: peça mudanças pelo nome da seção/tela ("na mockup MK-05 do editor de pedido…"). O Claude edita só o arquivo daquela parte e roda `node docs/blueprint/build.mjs`.

## 4. O que mudou e por quê

| Arquivo | Mudança | Efeito |
|---|---|---|
| `docs/blueprint/` (novo) | O `blueprint.html` (640 KB, ~200K tokens) virou 246 partes pequenas + `build.mjs` + `manifest.json` + `README.md`. O build remonta o arquivo original byte a byte e valida tags, ids duplicados e sintaxe JS. | Editar uma tela ou seção custa 300–3.000 tokens em vez de 200.000. Era a maior fonte do gasto. |
| `.claude/settings.json` | `"model": "sonnet"`; `Read/Edit/Write` de `docs/blueprint.html` bloqueados; build e `git diff --stat`/`status`/`log` liberados sem pergunta. Todas as regras `deny`/`ask` antigas foram mantidas. | O Claude não consegue mais carregar o arquivo gigante nem por engano. |
| `CLAUDE.md` | 208 → 112 linhas (19 KB → 16 KB). Mesmas regras de governança, invariantes reduzidos a "manchete + ID" (o texto completo continua em `decisions.md`). Seção nova **§5 Token discipline**: consultar docs por ID (`grep`), blueprint só pelas partes, validação de consistência em subagente, uma sessão por lote, Sonnet por padrão. | Carregado em toda sessão **e dentro de cada subagente**. |
| `.claude/agents/*.md` | `model: sonnet` em todos; seção "Read first" reescrita: não reler o `CLAUDE.md` (já está no contexto do agente), não abrir `decisions.md`/`architecture.md` inteiros — só as entradas citadas por ID. | Antes cada `architect` dispatch começava com ~30K tokens de leitura; agora só o que a tarefa cita. |
| `.claude/rules/security.md`, `testing.md` | Ganharam `paths:` (código, CI, Docker, `.env.example`, testes). As demais rules já tinham; `sync.md` foi adicionada para o protocolo offline. | Em modo design nenhuma rule carrega; na implementação carregam só ao tocar os arquivos certos. |

### Se quiser ajustar

- **`architect` em Opus:** troque `model: sonnet` por `model: opus` em `.claude/agents/architect.md`. Eu deixei Sonnet porque as decisões de fato acontecem na sessão principal com você.
- Se o Claude disser que "não pode ler `docs/blueprint.html`": é intencional. Ele deve usar `docs/blueprint/parts/`.
- Para validar visualmente o blueprint continua igual: abra `docs/blueprint.html` no navegador — é o mesmo arquivo.


## 5. Ajustes finais incluídos neste pacote

- 9º agente: `.claude/agents/sankhya-integration-engineer.md`.
- 9ª rule: `.claude/rules/sync.md`.
- Skill upstream `grilling` adicionada como dependência real de `grill-me`; `skills-lock.json` atualizado sem editar o vendor `grill-me`.
- `backend-engineer` deixou de reivindicar `packages/sankhya`/spikes para evitar ownership duplicado.
- `CLAUDE.md` atualizado apenas nos pontos de ownership e dependência de `grill-me`.


## 6. Validação final executada

Conferido neste pacote final:

- `node docs/blueprint/build.mjs --check` → `blueprint.html: up to date`, 246 partes, 54 seções, 98 telas, 117 IDs, `no problems found`.
- 9 agents e 9 rules.
- 20 skills locais e 20 entradas em `skills-lock.json`; nenhuma pasta sem lock e nenhuma entrada sem pasta.
- `settings.json`, `settings.local.json` e `skills-lock.json` com JSON válido.
- Nenhuma pasta de implementação (`apps/`, `packages/`, migrations ou `node_modules`) foi criada.
- Alterações em relação ao pacote recebido ficaram restritas à configuração final: agente Sankhya, rule de sync, dependência `grilling`, ownership do backend, `CLAUDE.md` e este LEIA-ME.
