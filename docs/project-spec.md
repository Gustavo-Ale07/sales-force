# Sales Force — Especificação do Projeto

> **Status:** rascunho para aprovação · **Data:** 2026-09-16
> **Regra:** nenhuma arquitetura detalhada ou implementação começa antes da aprovação deste documento.

---

## 1. Visão geral

### 1.1 Objetivo
Construir um sistema **sob medida, de uso interno**, que unifica em uma única plataforma:

1. **Força de vendas**, substituindo o **Vidya Force**: pedidos (inclusive offline) integrados ao **ERP Sankhya**, consulta de clientes, títulos, crédito, histórico, metas, positivação e comissões.
2. **CRM gerencial**, substituindo o **Agendor**: leads, empresas, contatos, funis, oportunidades, propostas, tarefas, follow-ups, automações e dashboards.

Com importação de planilhas, IA integrada e um assistente interno de dúvidas.

### 1.2 Problema atual
- Duas ferramentas pagas e desconectadas (Vidya Force + Agendor), com dados duplicados e sem visão única do cliente.
- O CRM não enxerga o que o cliente compra/deve no Sankhya; a força de vendas não enxerga o funil.

### 1.3 Critérios de sucesso
| Critério | Meta |
|---|---|
| Vidya Force desligado | Ao fim da Fase 1, após piloto em paralelo |
| Agendor desligado | Ao fim da Fase 2, com dados migrados |
| Pedidos pelo Sales Force | 100% dos pedidos de vendedores/representantes |
| Falhas de integração de pedido | < 1% dos pedidos exigindo intervenção manual |
| Sincronização incremental no app | < 30 s em 4G para uma carteira típica |
| Pedidos duplicados no Sankhya | Zero (garantido por idempotência) |

### 1.4 Premissas
- O Sankhya continua sendo o **sistema de registro** de clientes, produtos, preços, pedidos/notas, financeiro, metas e comissões.
- Sankhya **Cloud**, com acesso à **API oficial** (gateway com appkey/token).
- Sistema **single-tenant** (uma empresa), sem cobrança/assinatura.
- Desenvolvimento e manutenção pelo próprio dono do projeto, com apoio de IA (Claude Code).
- Sem prazo rígido de desligamento das ferramentas atuais.

---

## 2. Público-alvo e perfis

| Perfil | Quem é | Canal principal | Visibilidade |
|---|---|---|---|
| **Admin** | Responsável pelo sistema | Web | Tudo + configurações |
| **Diretoria** | Direção comercial | Web | Tudo (relatórios/dashboards; aprova descontos acima da alçada do gerente) |
| **Gerente/Supervisor** | Líder de equipe | Web (+ mobile) | Sua equipe |
| **Vendedor interno** | Inside sales/televendas | Web | Sua carteira |
| **Representante externo** | **Autônomo/PJ**, em campo | **App mobile offline** | Sua carteira, com restrições reforçadas |
| **Cadastro/Financeiro** | Backoffice | Web | Fila de aprovação de clientes novos; sem acesso ao funil |

- Escala: **20 a 100 usuários**.
- Base Sankhya: **médio porte** (~5 a 50 mil clientes, ~2 a 20 mil produtos).
- Ramo: **indústria**.

---

## 3. Escopo e fases

### Fase 0 — Fundação
- Monorepo, CI, ambientes (staging/produção) na VPS.
- Autenticação, perfis, hierarquia de equipes, auditoria básica.
- Cliente da API Sankhya + espelho incremental: vendedores, clientes/carteira, produtos, tabelas de preço.
- **Spike técnico Sankhya** (ver §17): validar serviços, limites de requisição, TOP de pedido e ambiente de homologação.

### Fase 1 — Força de vendas (substitui Vidya Force)
- App mobile **offline completo** (Android + iOS, distribuição privada).
- Clientes da carteira, contatos, histórico de compras, títulos em aberto/vencidos, limite de crédito.
- Pedido/orçamento com preço da tabela Sankhya, limite de desconto e alçada de aprovação.
- Envio do pedido ao Sankhya e acompanhamento de status.
- Cadastro de cliente novo (com **consulta CNPJ e CEP**) e fluxo de aprovação.
- Metas, positivação e comissões (leitura do Sankhya).
- Tarefas básicas com lembrete (inclusive offline) e notificações (push e central).
- Importação: **pedido do cliente via planilha** e **clientes novos em lote**.
- Mesmas funcionalidades na web para vendedores internos e gestores.
- Painel de saúde da integração.
- **Piloto** com um grupo de representantes em paralelo ao Vidya → desligamento.

### Fase 2 — CRM (substitui Agendor)
- Leads, empresas, contatos.
- Funis configuráveis, oportunidades, motivos de perda, conversão de oportunidade ganha em cliente.
- Propostas com produtos Sankhya, PDF, envio por e-mail e link de WhatsApp, aceite → pedido.
- Follow-ups, registro de interações, agenda, link de WhatsApp com registro manual.
- Automações pré-definidas: follow-up automático, distribuição de leads, alertas de carteira.
- Importação de listas de leads + **migração do Agendor**.
- Dashboards: vendas, funil, atividades, carteira/risco.
- Google Workspace (Gmail + Calendar).

### Fase 3 — Inteligência e canais
- Construtor de regras de automação ("quando X, se Y, faça Z").
- IA: assistente interno, resumo e próxima ação, sugestão de pedido/mix, alertas de churn, mapeamento de planilhas assistido.
- Captura de leads de formulários do site e anúncios (Meta/Google Ads).
- Telefonia/VoIP (click-to-call, registro e gravação de ligações).

### Fase 4 — Futuro (fora do escopo desta especificação)
- WhatsApp via API oficial (Meta Cloud API), com conversas dentro do CRM.
- Chatbot externo para clientes.

### Fora de escopo
- Multi-empresa/SaaS, cobrança e assinatura.
- Roteiro de visitas, check-in com GPS, pesquisas e fotos no ponto de venda.
- Trocas/devoluções.
- Consulta ou bloqueio por estoque.
- Cálculo próprio de metas e comissões (vêm prontas do Sankhya).
- Portal B2B de autoatendimento.
- Integração não oficial de WhatsApp.

---

## 4. Registro de decisões

| # | Decisão | Alternativas descartadas |
|---|---|---|
| D1 | Sistema interno, single-tenant | SaaS multi-tenant |
| D2 | Sankhya é o dono dos dados de ERP; o Sales Force é o dono dos dados de CRM | Duplicar o cadastro mestre |
| D3 | App mobile offline completo para representantes; web para os demais | PWA sempre online; offline só para rascunho |
| D4 | Preço da tabela Sankhya + limite de desconto + alçada de aprovação | Preço livre; preço fixo sem desconto |
| D5 | Estoque fora do escopo | Informativo ou bloqueante |
| D6 | Metas e comissões calculadas no Sankhya; o app só exibe | Cálculo próprio |
| D7 | Cliente novo passa por aprovação antes de virar parceiro no Sankhya | Criação direta |
| D8 | Tabela única de contas (lead → cliente) com vínculo ao parceiro Sankhya | Bases separadas CRM/ERP |
| D9 | Vários funis configuráveis | Funil único fixo |
| D10 | Proposta com produtos Sankhya → PDF → pedido | Proposta livre |
| D11 | Hierarquia de visibilidade (próprio / equipe / tudo) | Segmentação por filial |
| D12 | Representantes PJ: sem exportação, sem custo/margem, revogação e limpeza remota | Restrição padrão |
| D13 | WhatsApp via link + registro manual (API oficial só na Fase 4) | API não oficial |
| D14 | Ordem: força de vendas → CRM → IA/canais | CRM primeiro; tudo junto |
| D15 | Monólito modular, TypeScript full-stack, sincronização própria | PowerSync; microsserviços |
| D16 | Login só com e-mail e senha forte, **sem 2FA** (risco aceito, ver §17) | 2FA para gestores/todos |
| D17 | Pedido offline com preço alterado volta ao vendedor para revisão | Aplicar preço novo; manter preço antigo |
| D18 | Claude API com minimização de dados | Anonimização total |
| D19 | VPS + Docker Compose | PaaS; nuvem corporativa; on-premise |
| D20 | Testes em pirâmide focada nas regras críticas; o CI bloqueia merge | Meta global de cobertura |
| D21 | Limites de desconto configurados **no Sales Force** (por usuário, com padrão por perfil) | Ler de regra do Sankhya |

---

## 5. Requisitos funcionais por módulo

Convenção: `RF-<MÓDULO>-<n>`. A fase aparece entre colchetes.

### 5.1 Identidade e acesso (IAM)
- **RF-IAM-1 [F0]** Login por e-mail e senha. Senha com no mínimo 12 caracteres, verificada contra lista de senhas vazadas/comuns.
- **RF-IAM-2 [F0]** Bloqueio progressivo após tentativas falhas: 5 falhas → 15 min de bloqueio; bloqueios repetidos → admin desbloqueia.
- **RF-IAM-3 [F0]** Redefinição de senha por e-mail com link de uso único, válido por 30 min.
- **RF-IAM-4 [F0]** Admin cria, edita, desativa usuários e atribui perfil, gerente e código de vendedor no Sankhya (`CODVEND`).
- **RF-IAM-5 [F0]** Hierarquia: cada usuário pertence a uma equipe; cada equipe tem um gerente.
- **RF-IAM-6 [F0]** Permissões por perfil, com ajuste fino configurável pelo admin (ver matriz §8).
- **RF-IAM-7 [F1]** Registro de aparelhos por usuário do app. Admin pode **revogar** um usuário ou aparelho: invalida a sessão imediatamente e, na próxima conexão, o app **apaga o banco local**.
- **RF-IAM-8 [F1]** O app bloqueia o uso se ficar mais de **7 dias** (configurável) sem sincronizar, até conectar de novo. Isso limita a janela de uso de um aparelho revogado ou perdido.
- **RF-IAM-9 [F0]** Trilha de auditoria (ver §12.4).

### 5.2 Integração Sankhya (SNK)
- **RF-SNK-1 [F0]** Espelho incremental no Postgres, agendado pelo worker. Frequências iniciais:

  | Entidade | Frequência |
  |---|---|
  | Vendedores | 15 min |
  | Clientes/parceiros e carteira | 10 min |
  | Produtos | 15 min |
  | Tabelas de preço | 10 min |
  | Títulos financeiros | 15 min |
  | Pedidos/notas (status, histórico) | 5 min |
  | Metas, positivação, comissões | 60 min |

- **RF-SNK-2 [F0]** Reconciliação completa diária (madrugada) para corrigir diferenças e detectar exclusões.
- **RF-SNK-3 [F1]** Fila de saída (outbox) para escritas no Sankhya: pedidos e clientes aprovados. Tentativas com backoff exponencial, até 8 tentativas.
- **RF-SNK-4 [F1]** Toda escrita tem **chave de idempotência**: antes de reenviar, o worker verifica se o registro já existe no Sankhya (pelo identificador do Sales Force gravado em campo de observação/adicional).
- **RF-SNK-5 [F1]** Erros de integração ficam visíveis ao vendedor (status do pedido) e ao admin (painel), com mensagem traduzida e botão **reprocessar**.
- **RF-SNK-6 [F0]** Painel de saúde: último sucesso por entidade, atraso, erros nas últimas 24 h, tamanho da fila.
- **RF-SNK-7 [F0]** Alerta (e-mail ao admin) se a sincronização de alguma entidade ficar mais de 1 h sem sucesso ou se a fila de saída tiver itens em erro.
- **RF-SNK-8 [F0]** Todo o acesso ao Sankhya passa por uma interface `SankhyaGateway`, com implementação real e implementação falsa (desenvolvimento e testes).

### 5.3 Catálogo e preços (CAT)
- **RF-CAT-1 [F1]** Lista e busca de produtos (código, descrição, grupo, unidade, imagem quando houver), disponível offline.
- **RF-CAT-2 [F1]** Preço resolvido pela tabela de preço vigente aplicável ao cliente, conforme a regra do Sankhya mapeada no spike da Fase 0.
- **RF-CAT-3 [F1]** Limites de desconto (D21):
  - **limite do vendedor**: % máximo sem aprovação;
  - **limite do gerente**: % máximo que o gerente pode aprovar;
  - acima do limite do gerente, aprova a **diretoria**.

  Configurados por perfil (padrão) com sobrescrita por usuário.
- **RF-CAT-4 [F1]** Custo e margem **nunca** chegam ao app nem às telas de representantes PJ.

### 5.4 Contas: leads, empresas e clientes (ACC)
Uma **conta** representa uma empresa (ou pessoa física) em qualquer estágio do ciclo de vida:

```
lead → prospect → cliente_pendente → cliente
                       ↘ rejeitado
cliente → inativo (reflete o Sankhya)
```

- **RF-ACC-1 [F1]** Contas de clientes vêm do Sankhya (parceiros) e trazem `sankhya_codparc` e o vendedor responsável (carteira).
- **RF-ACC-2 [F1]** Ficha do cliente:
  - dados cadastrais e contatos;
  - histórico de compras (últimos pedidos, itens mais comprados, data da última compra);
  - títulos em aberto/vencidos, limite de crédito e crédito disponível;
  - oportunidades e atividades (F2).
- **RF-ACC-3 [F1]** Cadastro de cliente novo pelo vendedor/representante, inclusive offline:
  - CNPJ/CPF, razão social, fantasia, endereço, contatos, condição sugerida;
  - online, preenche automaticamente por **CNPJ** e **CEP**;
  - status inicial `cliente_pendente`.
- **RF-ACC-4 [F1]** Fila de aprovação (Cadastro/Financeiro):
  - revisa dados e define limite de crédito e condições;
  - **aprova** → criação do parceiro no Sankhya via outbox → status `cliente`;
  - **rejeita** → exige motivo → status `rejeitado`, com notificação ao vendedor.
- **RF-ACC-5 [F1]** Com o cliente pendente, o vendedor pode fazer **orçamentos**, mas o envio do pedido ao Sankhya só acontece após a aprovação. O pedido fica aguardando o cliente.
- **RF-ACC-6 [F1]** Deduplicação por CNPJ/CPF: se o documento já existe, o sistema avisa e mostra a conta existente (respeitando a visibilidade). Se for de outra carteira, oferece "solicitar transferência" ao gerente.
- **RF-ACC-7 [F2]** Leads e prospects criados manualmente, por importação ou por captura (F3). Sem CNPJ, a deduplicação usa e-mail e telefone normalizados.
- **RF-ACC-8 [F2]** Campos personalizados configuráveis pelo admin (texto, número, data, lista).
- **RF-ACC-9 [F2]** Tags e segmentação (origem, segmento, porte, região).

### 5.5 Contatos (CON)
- **RF-CON-1 [F1]** Pessoas vinculadas a uma conta: nome, cargo, e-mail, telefones, WhatsApp, aniversário, observações.
- **RF-CON-2 [F1]** Contatos do Sankhya são espelhados. Contatos criados no Sales Force ficam só no Sales Force.
- **RF-CON-3 [F2]** Ações rápidas: ligar, abrir WhatsApp com mensagem pronta, enviar e-mail. Cada ação oferece registrar a interação.

### 5.6 Pedidos (ORD)
- **RF-ORD-1 [F1]** Criação de orçamento/pedido, online e offline:
  - cliente;
  - empresa/filial e tipo de operação (TOP), com padrão configurável;
  - condição de pagamento / tipo de negociação;
  - itens (produto, quantidade, preço de tabela, % desconto, preço final);
  - observações.
- **RF-ORD-2 [F1]** Cálculo de totais, descontos e verificação de alçada pelo **mesmo código** no app e no servidor (`packages/domain`).
- **RF-ORD-3 [F1]** Bloqueios, avaliados offline com os dados da última sincronização e novamente no servidor:
  - cliente com títulos vencidos há mais de X dias (configurável): pedido bloqueado, com opção de enviar para aprovação;
  - total acima do crédito disponível: exige aprovação.
- **RF-ORD-4 [F1]** Estados:

  ```
  rascunho → aguardando_aprovacao → aprovado → na_fila → enviado (NUNOTA) → faturado
                     ↘ reprovado                       ↘ erro_integracao
  rascunho/aprovado → revisao_preco → (vendedor confirma) → fluxo normal
  qualquer estado não enviado → cancelado
  enviado → cancelado (refletido do Sankhya)
  ```

- **RF-ORD-5 [F1]** Pedido com desconto acima do limite vai para `aguardando_aprovacao`. O aprovador (gerente ou diretoria, pela alçada) aprova ou reprova com comentário. O vendedor é notificado.
- **RF-ORD-6 [F1] (D17)** Revisão de preço: quando o pedido criado offline chega ao servidor e o preço de tabela de algum item mudou, o pedido vai para `revisao_preco`. O app mostra item a item o preço anterior e o novo. O vendedor confirma (e o pedido segue o fluxo, reavaliando a alçada) ou edita.
- **RF-ORD-7 [F1]** Acompanhamento: status, número no Sankhya (NUNOTA), data de faturamento e nota fiscal quando disponível.
- **RF-ORD-8 [F1]** Duplicar pedido anterior ("repetir pedido") como novo rascunho, com preços atualizados.
- **RF-ORD-9 [F1]** **Importação de pedido do cliente por planilha** (ver §5.12):
  - colunas mínimas: código do produto (ou EAN/código do cliente mapeado) e quantidade;
  - gera um rascunho com preços da tabela;
  - linhas não reconhecidas ficam listadas para correção.
- **RF-ORD-10 [F1]** PDF/compartilhamento do orçamento (WhatsApp/e-mail) a partir do app.

### 5.7 Funis e oportunidades (OPP)
- **RF-OPP-1 [F2]** Admin/gerente cria **funis** com etapas ordenadas. Cada etapa tem nome, probabilidade padrão (%) e, opcionalmente, **dias máximos parada** (para alerta).
- **RF-OPP-2 [F2]** Oportunidade:
  - conta, contato principal, funil, etapa, responsável;
  - valor estimado, data prevista de fechamento, origem, produtos de interesse;
  - status `aberta | ganha | perdida`.
- **RF-OPP-3 [F2]** Visão **kanban** (arrastar entre etapas) e **lista** com filtros, nos dois casos respeitando a visibilidade.
- **RF-OPP-4 [F2]** Perda exige **motivo** (lista configurável) e comentário opcional.
- **RF-OPP-5 [F2]** Ganho:
  - se a conta não é cliente, inicia o **cadastro de cliente novo** pré-preenchido (RF-ACC-3), que segue para aprovação;
  - se há proposta aceita, oferece gerar o pedido (RF-PRP-6).
- **RF-OPP-6 [F2]** Histórico completo de mudanças de etapa (quem, quando, tempo em cada etapa).
- **RF-OPP-7 [F2]** Oportunidades também para clientes existentes (ex.: grandes contas, novos produtos).

### 5.8 Propostas (PRP)
- **RF-PRP-1 [F2]** Proposta vinculada a uma oportunidade e a uma conta, com itens do catálogo Sankhya, mesmas regras de preço, desconto e alçada dos pedidos.
- **RF-PRP-2 [F2]** Campos: validade, condição de pagamento, prazo de entrega (texto), observações e termos.
- **RF-PRP-3 [F2]** Versões: editar uma proposta enviada cria nova versão; as anteriores ficam consultáveis.
- **RF-PRP-4 [F2]** Geração de **PDF** com modelo da marca (logo, cores, rodapé configuráveis).
- **RF-PRP-5 [F2]** Envio por e-mail (Gmail do usuário) ou link de WhatsApp com o PDF. O envio registra a atividade e dispara a automação de follow-up.
- **RF-PRP-6 [F2]** Status `rascunho | aguardando_aprovacao | enviada | aceita | recusada | expirada`. Ao marcar **aceita**, um clique gera o pedido. Se a validade venceu ou o preço mudou, aplica a revisão de preço (RF-ORD-6).
- **RF-PRP-7 [F2]** Expiração automática ao passar da validade, com notificação ao responsável.

### 5.9 Tarefas, follow-ups e interações (ACT)
- **RF-ACT-1 [F1]** Tarefa:
  - tipo (`ligação | visita | e-mail | WhatsApp | reunião | outro`);
  - título, descrição, data/hora, responsável;
  - vínculo opcional com conta, contato, oportunidade, proposta ou pedido;
  - status `pendente | concluída | cancelada`.
- **RF-ACT-2 [F1]** Tarefas disponíveis offline no app. Criar e concluir offline sincroniza depois.
- **RF-ACT-3 [F1]** Lembretes por notificação push e na web.
- **RF-ACT-4 [F2]** **Follow-up**: tarefa gerada a partir de outra ação (manual: "agendar follow-up"; ou automática, §5.10), com origem rastreável.
- **RF-ACT-5 [F2]** **Interação registrada**: atividade concluída com resultado e anotação, formando a linha do tempo da conta e da oportunidade.
- **RF-ACT-6 [F2]** Agenda (dia/semana) e lista "minhas tarefas" com atrasadas em destaque.
- **RF-ACT-7 [F2]** Sincronização **Sales Force → Google Calendar** (unidirecional) para tarefas com horário.
- **RF-ACT-8 [F2]** Gerente vê e reatribui tarefas da equipe.

### 5.10 Automações (AUT)
- **RF-AUT-1 [F2] Follow-up automático** (regras pré-definidas, parâmetros configuráveis):
  - proposta enviada → tarefa de follow-up em N dias;
  - oportunidade mudou para etapa X → tarefa Y;
  - oportunidade parada além dos dias máximos da etapa → alerta ao responsável e ao gerente.
- **RF-AUT-2 [F2] Distribuição de leads** para leads novos (importação, formulário, anúncio). Estratégia configurável por origem:
  - por região (UF/cidade → vendedor);
  - rodízio (round-robin) dentro de uma equipe;
  - por carga (menos oportunidades abertas).
- **RF-AUT-3 [F2] Alertas de carteira**:
  - cliente sem comprar há N dias;
  - título vencido;
  - pedido faturado ou cancelado;
  - cliente novo aprovado ou rejeitado.
- **RF-AUT-4 [F3] Construtor de regras** "quando X, se Y, faça Z":
  - **gatilhos**: registro criado/alterado (conta, oportunidade, proposta, pedido, tarefa), mudança de etapa/status, agendamento (diário/semanal), evento de integração;
  - **condições**: comparações de campos, e/ou;
  - **ações**: criar tarefa, notificar usuário/perfil, atribuir responsável, mudar etapa, adicionar tag, enviar e-mail por modelo, chamar webhook.
- **RF-AUT-5 [F2]** Log de execução por regra (quando rodou, registro afetado, resultado/erro).
- **RF-AUT-6 [F2]** Proteção contra laços: limite de profundidade de encadeamento (3) e de execuções por registro/minuto.

### 5.11 Metas, positivação e comissões (GOL)
- **RF-GOL-1 [F1]** Exibir metas do vendedor (valor/volume, por período e, quando houver, por produto/grupo) e o realizado, a partir do Sankhya.
- **RF-GOL-2 [F1]** Positivação: clientes da carteira que compraram no período, contra o total da carteira.
- **RF-GOL-3 [F1]** Comissões do vendedor por período (previstas/liberadas conforme disponível no Sankhya). O vendedor vê só as próprias; o gerente, as da equipe.

### 5.12 Importação de planilhas (IMP)
- **RF-IMP-1 [F1]** Upload de `.xlsx` ou `.csv` (até 20 MB / 50 mil linhas).
- **RF-IMP-2 [F1]** Assistente em etapas:
  1. escolher o tipo;
  2. **mapear colunas** (sugestão automática por nome; por IA na F3);
  3. **pré-visualizar e validar** (erros por linha, duplicados);
  4. confirmar;
  5. processar em segundo plano;
  6. relatório final com planilha de erros para download.
- **RF-IMP-3** Tipos de importação:

  | Tipo | Fase | Destino |
  |---|---|---|
  | Pedido do cliente | F1 | Rascunho de pedido (RF-ORD-9) |
  | Clientes novos em lote | F1 | Contas `cliente_pendente` → fila de aprovação |
  | Listas de leads | F2 | Contas `lead`, deduplicadas, com distribuição automática opcional |
  | Migração do Agendor | F2 | Empresas, pessoas, negócios (abertos e fechados), tarefas, histórico/anotações |
  | Atualização em massa | F2 | Reatribuir responsável, etapa, tags (apenas admin/gerente) |

- **RF-IMP-4 [F2]** Migração do Agendor feita como **carga única assistida**, com mapeamento salvo (funis/etapas do Agendor → funis do Sales Force, usuários → usuários) e execução em staging antes de produção.
- **RF-IMP-5** Representantes PJ podem importar (pedido do cliente, clientes novos), mas **nunca exportar**.

### 5.13 Dashboards e relatórios (DSH)
Todos com filtros de período, equipe, vendedor e respeitando a visibilidade.

- **RF-DSH-1 [F2] Vendas** (dados do Sankhya):
  - faturamento e pedidos por período;
  - ticket médio;
  - metas × realizado;
  - positivação;
  - comissão;
  - ranking de vendedores;
  - vendas por produto/grupo e por cliente.
- **RF-DSH-2 [F2] Funil**:
  - valor e quantidade por etapa;
  - conversão entre etapas;
  - ciclo médio de venda;
  - motivos de perda;
  - previsão (soma ponderada por probabilidade e data prevista).
- **RF-DSH-3 [F2] Atividades**: tarefas criadas, concluídas e atrasadas, e interações por tipo, por vendedor.
- **RF-DSH-4 [F2] Carteira e risco**:
  - clientes inativos por faixa de dias;
  - queda de compra (período atual × média anterior);
  - inadimplência;
  - clientes novos pendentes.
- **RF-DSH-5 [F1]** No app, painel resumido do vendedor: meta do mês, realizado, positivação, pedidos pendentes/erro, tarefas do dia.
- **RF-DSH-6 [F2]** Exportação de relatórios (CSV/XLSX) para perfis internos com permissão. **Proibida para representantes PJ.**

### 5.14 Notificações (NOT)
- **RF-NOT-1 [F1]** Central de notificações na web e no app, com push no mobile.
- **RF-NOT-2 [F1]** Eventos mínimos:
  - pedido aprovado, reprovado, com erro, em revisão de preço ou faturado;
  - cliente novo aprovado ou rejeitado;
  - tarefa vencendo;
  - aprovação pendente (para aprovadores).
- **RF-NOT-3 [F2]** Preferências por usuário (quais eventos, push/e-mail).

### 5.15 Integrações externas (INT)
- **RF-INT-1 [F1]** **CNPJ**: BrasilAPI, com provedor alternativo e cache de 30 dias.
- **RF-INT-2 [F1]** **CEP**: BrasilAPI/ViaCEP, com cache.
- **RF-INT-3 [F2]** **Google Workspace**:
  - OAuth por usuário;
  - envio de e-mail pelo Gmail do usuário (propostas, modelos) com registro automático da atividade;
  - criação de eventos no Google Calendar (RF-ACT-7).
- **RF-INT-4 [F2]** **WhatsApp (link)**: botão que abre `wa.me` com mensagem pronta e oferece registrar a interação.
- **RF-INT-5 [F3]** **Formulários do site**: endpoint de webhook com token por formulário, mapeamento de campos, anti-spam (honeypot + rate limit) → lead + distribuição.
- **RF-INT-6 [F3]** **Anúncios**: Meta Lead Ads e Google Ads (lead form) via webhook oficial → lead com origem/campanha.
- **RF-INT-7 [F3]** **Telefonia/VoIP**:
  - click-to-call;
  - registro automático da ligação (duração, resultado) e link da gravação;
  - provedor escolhido no início da F3, atrás da interface `TelephonyProvider`.

---

## 6. IA (IA)

### 6.1 Recursos
- **RF-IA-1 [F3] Assistente interno** (web e app, apenas online):
  - dúvidas sobre **uso do sistema**, **produtos** (fichas técnicas), **políticas comerciais e processos** (base de conhecimento mantida pelo admin);
  - **consultas a dados** em linguagem natural (ex.: "quais clientes da minha carteira não compram há 60 dias?"), executadas por **ferramentas** que chamam a API do Sales Force **com as permissões do usuário logado**.
- **RF-IA-2 [F3] Resumo e próxima ação**: na ficha da conta ou da oportunidade, gera resumo (histórico de compras, interações, títulos, oportunidades) e sugere o próximo passo. Sob demanda, com cache até a próxima mudança relevante.
- **RF-IA-3 [F3] Sugestão de pedido/mix**:
  - candidatos calculados **estatisticamente** (reposição pela frequência de compra do cliente; produtos comprados por clientes semelhantes);
  - a IA só ordena e explica;
  - aparece como sugestão ao montar o pedido (inclusive offline, com as sugestões pré-calculadas baixadas na sincronização).
- **RF-IA-4 [F3] Alertas de churn/risco**:
  - score calculado por regras (queda de frequência/valor, atraso de compra em relação ao padrão);
  - lote noturno com explicação por IA para os casos priorizados;
  - vira alerta de carteira (RF-AUT-3).
- **RF-IA-5 [F3] Mapeamento de planilhas assistido**: a IA recebe cabeçalhos + 5 linhas de amostra e sugere o mapeamento e as normalizações. **O usuário sempre confirma** antes de importar.

### 6.2 Diretrizes técnicas
- **Provedor:** Claude API, via SDK oficial `@anthropic-ai/sdk`, chamado **somente pelo backend** (a chave nunca vai para web ou app).
- **Modelo padrão:** `claude-opus-5`, com **effort** por rota:
  - `low`: mapeamento de planilhas, classificação;
  - `medium`: resumos, explicação de churn/mix;
  - `high`: assistente com ferramentas.

  Modelo e effort de cada rota ficam em configuração, permitindo trocar por um modelo mais barato após medir a qualidade.
- **Assistente com ferramentas:**
  - ferramentas de leitura tipadas e validadas (buscar contas, pedidos, títulos, oportunidades, tarefas, métricas);
  - **sem ferramentas de escrita** na F3 (o assistente sugere, o usuário executa);
  - ferramentas e instruções de sistema estáveis, com **prompt caching**.
- **Saídas estruturadas** (`output_config.format`) para resumo, mapeamento e explicações.
- **Lotes noturnos** (churn, mix) pela **Batch API**.
- **Tratamento de respostas:** checar `stop_reason` (incluindo `refusal`) antes de usar a resposta; erros da API tratados por tipo (limite de requisições com nova tentativa; erro de requisição sem nova tentativa).
- **Minimização (D18):**
  - envia só os campos necessários para a pergunta;
  - nunca envia custo/margem, senhas, tokens ou dados de outros usuários fora da visibilidade;
  - a base de conhecimento não inclui dados pessoais.
- **Controle de custo:**
  - registro de tokens de entrada/saída/cache e custo por requisição, usuário e recurso;
  - **teto mensal** global e por usuário, com bloqueio e aviso ao admin.
- **Qualidade:**
  - conjunto de avaliação (eval) com perguntas reais do assistente e casos de mapeamento;
  - rodado antes de trocar modelo, effort ou prompt.

---

## 7. Arquitetura

### 7.1 Visão
**Monólito modular** em TypeScript, com sincronização offline própria (D15).

```
                ┌───────────────── VPS (Docker Compose) ─────────────────┐
 Web (Next.js) ─┤  Caddy (HTTPS) ─► api (NestJS) ─► PostgreSQL           │
                │                      │   ▲                             │
 App (Expo) ────┤                      ▼   │                             │
  SQLite local  │                    Redis (BullMQ)                      │
                │                      │                                 │
                │                   worker ─► Sankhya API (Cloud)        │
                │                      ├───► Claude API                  │
                │                      ├───► Google, BrasilAPI, etc.     │
                │                    MinIO (arquivos, S3)                │
                └────────────────────────────────────────────────────────┘
```

- **api**: REST + OpenAPI; autenticação, regras de negócio, endpoints de sincronização, webhooks de entrada.
- **worker**: jobs agendados e filas (espelho Sankhya, outbox, automações, importações, IA em lote, e-mails, PDFs).
- **web**: Next.js (vendedores internos, gestores, backoffice, admin).
- **mobile**: Expo/React Native com SQLite criptografado (representantes; também usável por internos).
- O **app nunca fala com o Sankhya**: tudo passa pelo espelho e pela outbox da api/worker.

### 7.2 Monorepo
```
apps/
  api/          NestJS
  worker/       processadores BullMQ + agendamentos
  web/          Next.js
  mobile/       Expo
packages/
  domain/       regras puras: preço, desconto, alçada, crédito, estados de pedido/proposta/oportunidade
  db/           schema Drizzle (Postgres) + migrations
  mobile-db/    schema Drizzle (SQLite) + migrations locais
  contracts/    DTOs/esquemas Zod compartilhados (API ↔ web ↔ mobile), protocolo de sync
  sankhya/      SankhyaGateway (cliente real + fake + fixtures gravadas)
  ui/           componentes compartilhados da web
  config/       eslint, tsconfig, prettier
```

**Regras de fronteira:**
- `domain` não depende de nada de infraestrutura.
- Módulos da api só conversam entre si por serviços públicos, sem acessar tabelas uns dos outros.
- `sankhya` é o único lugar que conhece o formato da API Sankhya.

### 7.3 Stack
| Camada | Escolha |
|---|---|
| Linguagem | TypeScript (strict) em tudo |
| Gerência do monorepo | pnpm workspaces + Turborepo |
| API | NestJS, validação com Zod, OpenAPI gerado |
| ORM | Drizzle ORM (Postgres e SQLite) |
| Banco | PostgreSQL 16+ |
| Filas/jobs | BullMQ + Redis |
| Web | Next.js (App Router), React, TanStack Query, Tailwind CSS, componentes shadcn/ui |
| Mobile | Expo (React Native), expo-sqlite com SQLCipher, Expo Router, expo-secure-store, EAS Build/Update |
| Arquivos | MinIO (API S3) |
| PDF | Renderização HTML → PDF no worker (Playwright/Chromium) |
| IA | `@anthropic-ai/sdk` |
| Observabilidade | Logs JSON (pino), Sentry (api, worker, web, mobile), healthchecks |
| Proxy/HTTPS | Caddy |
| CI/CD | GitHub Actions |

---

## 8. Permissões

### 8.1 Modelo
- **RBAC**: permissões nomeadas (ex.: `order.approve`, `account.export`) agrupadas por perfil. O admin ajusta as permissões de cada perfil.
- **Escopo de dados** por perfil:
  - `proprio`: registros em que o usuário é responsável, mais os da sua carteira Sankhya;
  - `equipe`: registros da equipe que gerencia (incluindo os próprios);
  - `tudo`.
- O filtro de escopo é aplicado **no servidor**, numa camada única de acesso a dados. Endpoints de sincronização usam o mesmo filtro.

### 8.2 Matriz padrão

| Capacidade | Admin | Diretoria | Gerente | Vend. interno | Repr. PJ | Cadastro/Fin. |
|---|---|---|---|---|---|---|
| Escopo de dados | tudo | tudo | equipe | próprio | próprio | tudo (só contas/pendências) |
| Ver clientes, títulos, histórico | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Criar pedido/orçamento | ✔ | — | ✔ | ✔ | ✔ | — |
| Aprovar desconto | ✔ | ✔ (acima do gerente) | ✔ (até seu limite) | — | — | — |
| Cadastrar cliente novo | ✔ | — | ✔ | ✔ | ✔ | ✔ |
| Aprovar cliente novo | ✔ | — | — | — | — | ✔ |
| Funis e oportunidades | ✔ (config.) | ver | ✔ | ✔ | ✔ | — |
| Propostas | ✔ | ver | ✔ | ✔ | ✔ | — |
| Tarefas | ✔ | ver | ✔ (equipe) | ✔ | ✔ | ✔ (próprias) |
| Configurar automações | ✔ | — | ✔ (equipe) | — | — | — |
| Importar planilhas | ✔ | — | ✔ | ✔ (pedido, clientes, leads) | ✔ (pedido, clientes) | ✔ (clientes) |
| Exportar dados/relatórios | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ |
| Ver custo/margem | ✔ | ✔ | configurável | — | **✖** | — |
| Dashboards | todos | todos | equipe | próprios | próprios (resumo) | carteira/pendências |
| Assistente IA | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Usuários, integrações, configurações | ✔ | — | — | — | — | — |

---

## 9. Banco de dados

### 9.1 Convenções
- PostgreSQL. Chaves primárias **UUIDv7** geradas pelo cliente (app/web) ou pelo servidor.
- Colunas padrão em tabelas sincronizáveis: `created_at`, `updated_at`, `deleted_at` (exclusão lógica), `created_by`, `updated_by`, `change_seq` (bigint de uma sequência global, atualizado a cada escrita, via trigger).
- Tabelas espelhadas do Sankhya guardam a chave de origem (`sankhya_*`) e `sankhya_synced_at`.
- Dinheiro em `numeric(14,2)`; percentuais em `numeric(7,4)`; quantidades em `numeric(14,4)`.
- Textos de busca com `pg_trgm` (nome, razão social, descrição de produto).

### 9.2 Entidades principais

**Identidade**
- `users`: nome, e-mail, hash de senha, perfil, equipe, `sankhya_codvend`, ativo, bloqueio.
- `teams`: nome, gerente.
- `roles`, `role_permissions`: perfil → permissões e escopo.
- `devices`: usuário, identificador, plataforma, último sync, `revoked_at`.
- `sessions` / `refresh_tokens`.
- `discount_limits`: perfil ou usuário, limite (%).

**Sankhya / catálogo**
- `products`: código, descrição, grupo, unidade, EAN, ativo, imagem.
- `price_tables`, `price_table_items`: tabela, produto, preço, vigência.
- `price_rules`: regra de resolução da tabela por cliente, conforme o mapeamento do spike.
- `payment_terms`: condições/tipos de negociação.
- `operation_types`: TOPs habilitadas para pedido.
- `sankhya_sync_state`: entidade, cursor, último sucesso, erro.
- `integration_outbox`: tipo, payload, chave de idempotência, status, tentativas, próximo horário, erro.

**Contas e contatos**
- `accounts`:
  - tipo (PJ/PF), documento, razão social, fantasia, endereço;
  - `lifecycle_status` (lead, prospect, cliente_pendente, cliente, rejeitado, inativo);
  - `owner_user_id`, origem, tags, `sankhya_codparc`;
  - limite de crédito, bloqueio, campos personalizados (jsonb).
- `account_approvals`: conta, solicitante, decisor, decisão, motivo, datas.
- `contacts`: conta, nome, cargo, e-mail, telefones, WhatsApp, `sankhya_*`.
- `custom_field_defs`: entidade, nome, tipo, opções.

**Financeiro e histórico (espelho, somente leitura)**
- `receivables`: conta, documento, emissão, vencimento, valor, saldo, situação.
- `sales_documents`: conta, NUNOTA, tipo, datas, valor total, status, vendedor.
- `sales_document_items`: produto, quantidade, valor.
- `goals`: vendedor, período, tipo, alvo, realizado.
- `commissions`: vendedor, período, base, valor, situação.

**Pedidos**
- `orders`:
  - conta, empresa, TOP, condição, tabela de preço, totais, status;
  - `idempotency_key`, `sankhya_nunota`, `origin` (app/web/import/proposta), `client_created_at`.
- `order_items`: produto, quantidade, preço de tabela, % desconto, preço final, `price_snapshot_at`.
- `order_approvals`: nível, aprovador, decisão, comentário.
- `order_status_history`.

**CRM**
- `pipelines`, `pipeline_stages` (ordem, probabilidade, dias máximos).
- `opportunities`: conta, contato, funil, etapa, responsável, valor, data prevista, status, motivo de perda, origem.
- `opportunity_stage_history`.
- `loss_reasons`.
- `proposals` (oportunidade, conta, versão, status, validade, condição, PDF), `proposal_items`.
- `activities`:
  - tipo, título, descrição, data/hora, responsável, status, resultado;
  - vínculos polimórficos explícitos (`account_id`, `contact_id`, `opportunity_id`, `proposal_id`, `order_id`);
  - `origin` (manual/automação), `google_event_id`.
- `tags`, `entity_tags`.

**Automação, importação, IA, sistema**
- `automation_rules` (gatilho, condições, ações em jsonb, ativo), `automation_runs`.
- `lead_distribution_rules`.
- `imports` (tipo, arquivo, mapeamento, status, contagens), `import_row_errors`.
- `ai_requests` (usuário, recurso, modelo, tokens, custo, duração, status).
- `ai_budgets`.
- `knowledge_documents` (base do assistente).
- `notifications`, `notification_preferences`.
- `audit_log` (ator, ação, entidade, id, antes/depois resumido, IP, aparelho, data).
- `files` (chave no MinIO, tipo, tamanho, dono).
- `integration_credentials` (Google OAuth por usuário, criptografado).

### 9.3 Banco local do app (SQLite)
- Subconjunto filtrado pela carteira:
  - contas e contatos da carteira;
  - produtos e preços aplicáveis;
  - condições e TOPs;
  - títulos e histórico resumido (últimos 12 meses);
  - metas, positivação e comissões do vendedor;
  - pedidos (últimos 90 dias + abertos);
  - tarefas (abertas + últimos 30 dias);
  - sugestões de mix (F3).
- Tabelas locais extras: `sync_state` (cursor) e `outbox` (comandos pendentes).
- Criptografado com SQLCipher; a chave fica no armazenamento seguro do aparelho.

---

## 10. Protocolo de sincronização offline

### 10.1 Download (pull)
- `GET /sync/pull?cursor=<change_seq>&limit=<n>`: devolve alterações das entidades sincronizáveis com `change_seq > cursor`, **filtradas pelo escopo do usuário**, em blocos, com o novo cursor.
- Cada item é `upsert` ou `delete` (tombstone).
- Registros que **saem do escopo** (troca de carteira, exclusão, revogação) chegam como `delete`. O servidor calcula isso comparando a carteira anterior com a atual, por um registro de mudanças de atribuição.
- **Carga inicial**: download completo em blocos, com barra de progresso e possibilidade de continuar de onde parou.
- Versão do protocolo no cabeçalho. O servidor recusa apps abaixo da **versão mínima**, o que força a atualização.

### 10.2 Envio (push)
- O app grava comandos numa `outbox` local, em ordem: `createOrder`, `updateOrder`, `createAccount`, `createActivity`, `completeActivity`, `createContact`, entre outros.
- `POST /sync/push` envia os comandos em lote. Cada comando leva `command_id` (idempotência) e `entity_id` (UUIDv7).
- O servidor processa cada comando de forma independente e **revalida tudo** (permissão, preço, alçada, crédito). Resposta por comando:
  - `accepted`, com o estado resultante;
  - `rejected`, com motivo legível;
  - `needs_review` (ex.: revisão de preço).
- Reenvio do mesmo `command_id` devolve o resultado original, sem efeito duplicado.

### 10.3 Conflitos
| Caso | Regra |
|---|---|
| Dados espelhados do Sankhya | Somente leitura no app; o servidor sempre vence |
| Preço mudou desde a criação offline | `revisao_preco` (RF-ORD-6) |
| Pedido já enviado ao Sankhya | Não é editável; alterações só no Sankhya |
| Registro do CRM editado em dois lugares | Por campo: vale a escrita com `updated_at` mais recente, com histórico preservado na auditoria |
| Conta saiu da carteira com comando pendente | Comando rejeitado com motivo; o rascunho fica visível ao usuário para exportar a informação ao gerente (sem dados sensíveis) |

### 10.4 Gatilhos de sincronização no app
- Ao abrir o app.
- Ao voltar a ter conexão.
- A cada 15 min em primeiro plano.
- Manualmente ("sincronizar agora").
- Após salvar um pedido, se houver conexão.

---

## 11. Integração Sankhya (detalhes)

- **Acesso:** API oficial do Sankhya Cloud (gateway com appkey/token). Credenciais só no servidor.
- **Leituras:** consultas incrementais por data de alteração ou chave crescente, conforme a entidade, usando os serviços de carga de registros e consulta da API. Tabelas de referência a validar no spike:
  - parceiros (`TGFPAR`);
  - vendedores (`TGFVEN`);
  - produtos (`TGFPRO`);
  - preços (`TGFTAB`/`TGFEXC`);
  - cabeçalho e itens de notas/pedidos (`TGFCAB`/`TGFITE`);
  - financeiro (`TGFFIN`);
  - metas e comissões (tabelas a identificar conforme a configuração da empresa).
- **Escritas:**
  - pedido: inclusão de nota/pedido com a TOP configurada;
  - cliente aprovado: inclusão de parceiro.
- **Identificador de origem:** o UUID do Sales Force é gravado no documento/parceiro (campo adicional ou observação padronizada), para idempotência e rastreio.
- **Limites:** respeitar os limites de requisição do gateway com concorrência controlada por fila e pausas automáticas ao receber 429/5xx.
- **Ambientes:** homologação Sankhya para staging; produção para produção. Nunca misturar credenciais.
- **Entregáveis do spike (Fase 0):**
  1. mapa de serviços e tabelas por entidade;
  2. regra real de resolução de tabela de preço por cliente;
  3. TOP, empresa e campos obrigatórios do pedido;
  4. forma de detectar alterações e exclusões;
  5. limites de requisição medidos;
  6. respostas reais gravadas para testes de contrato.

---

## 12. Segurança e LGPD

### 12.1 Autenticação (D16)
- Senha com hash **Argon2id**. Política de senha forte (RF-IAM-1). Bloqueio progressivo (RF-IAM-2).
- **Web:** sessão em cookie `httpOnly`, `Secure`, `SameSite=Lax`, com proteção CSRF. Expira após 12 h de inatividade.
- **Mobile:** access token (JWT, 15 min) + refresh token rotativo (30 dias, invalidado ao reutilizar), guardado no `SecureStore`.
- **Risco aceito:** sem 2FA. A decisão é reavaliada se ocorrer incidente de acesso indevido ou mudança no perfil dos usuários.

### 12.2 Proteção de dados no aparelho
- SQLite criptografado (SQLCipher).
- Revogação apaga o banco local (RF-IAM-7).
- Bloqueio após 7 dias sem sincronizar (RF-IAM-8).
- Sem exportação para representantes PJ. Compartilhamento limitado a PDF de orçamento/proposta do próprio cliente.

### 12.3 Aplicação e infraestrutura
- HTTPS obrigatório (Caddy); HSTS.
- Rate limit por IP e por usuário (login, sync, webhooks, IA).
- Validação de toda entrada com Zod; consultas parametrizadas (ORM).
- Segredos em variáveis de ambiente fora do repositório. Credenciais de terceiros (Google) criptografadas no banco.
- Webhooks de entrada autenticados por token/assinatura.
- Postgres, Redis e MinIO sem exposição pública (rede interna do Docker).
- Atualizações de dependências monitoradas (Dependabot/Renovate) e varredura de vulnerabilidades no CI.
- **Backups:**
  - dump diário do Postgres + WAL/incremental;
  - retenção de 30 dias;
  - cópia fora da VPS (armazenamento S3 externo);
  - **teste de restauração mensal**.

### 12.4 Auditoria
Registra:
- login, falha de login e bloqueio;
- criação, revogação e mudança de perfil de usuário;
- aprovação/reprovação de pedido e de cliente;
- alteração de limites de desconto;
- exportações e importações;
- alterações de automações;
- ações administrativas.

Retenção mínima de 1 ano.

### 12.5 LGPD
- Base legal: **legítimo interesse** (relacionamento B2B) e **execução de contrato** (clientes).
- Registro das finalidades de tratamento e dos operadores (Sankhya, Google, Anthropic, provedores de CNPJ/CEP/VoIP, hospedagem).
- Atendimento a titulares: localizar, exportar (admin) e **anonimizar** leads/contatos sob solicitação.
- Retenção: leads sem interação por 24 meses são sinalizados para revisão/anonimização.
- IA com minimização (§6.2); a Anthropic não usa os dados da API para treinamento.

---

## 13. Requisitos não funcionais

| Requisito | Meta |
|---|---|
| Latência API (p95) | < 500 ms nas operações comuns; < 2 s em dashboards |
| App offline | Listas e buscas locais < 300 ms com a carteira completa |
| Carga inicial do app | < 5 min em 4G para uma carteira típica |
| Disponibilidade | 99,5% em horário comercial |
| Escala de projeto | 100 usuários simultâneos, com folga para 3× a base atual |
| Recuperação | RPO ≤ 24 h (dump) com WAL para reduzir; RTO ≤ 4 h |
| Compatibilidade mobile | Android 10+ e iOS 16+ |
| Navegadores | Últimas 2 versões de Chrome, Edge, Safari e Firefox |
| Idioma | Português (Brasil); datas, moeda e documentos no padrão brasileiro |
| Acessibilidade web | WCAG 2.1 AA nas telas principais |

---

## 14. Deploy e operação

- **Ambientes:**
  - `staging`: conectado à homologação do Sankhya;
  - `production`.
- **VPS** com Docker Compose: `caddy`, `api`, `worker`, `web`, `postgres`, `redis`, `minio`. Imagens construídas no CI e publicadas num registry.
- **Pipeline:**
  - PR → lint, verificação de tipos, testes, build;
  - merge na `main` → deploy automático em staging;
  - **tag de versão** → deploy em produção.
- **Migrations** executadas automaticamente no deploy, sempre compatíveis com a versão anterior (expandir → migrar → contrair).
- **Mobile:**
  - EAS Build;
  - Android via **Managed Google Play** (app privado);
  - iOS via **Apple Business Manager** (distribuição privada) ou TestFlight;
  - **EAS Update** para correções JS;
  - mudanças no protocolo de sincronização exigem nova versão mínima.
- **Observabilidade:**
  - Sentry em todos os apps;
  - logs estruturados com correlação por requisição;
  - endpoint `/health` (api, worker, Sankhya, fila);
  - uptime monitor externo;
  - alertas por e-mail ao admin.
- **Operação de rotina:**
  - painel de saúde da integração;
  - fila de erros com reprocessamento;
  - painel de custos de IA.

---

## 15. Estratégia de testes

| Camada | O quê | Ferramenta |
|---|---|---|
| **Unitário (TDD)** | `packages/domain`: preço, desconto, alçada, crédito, transições de estado de pedido/proposta/oportunidade/conta, regras de automação, deduplicação | Vitest |
| **Integração API** | Endpoints com Postgres real; **testes de permissão** (vendedor não vê carteira alheia; PJ não exporta nem vê custo) | Vitest + Testcontainers |
| **Sincronização** | Idempotência de push, avanço de cursor, tombstones por troca de carteira, revogação, revisão de preço, conflitos por campo | Vitest + Testcontainers |
| **Contrato Sankhya** | `SankhyaGateway` contra respostas reais gravadas no spike; suíte de fumaça contra a homologação (manual/agendada, fora do CI de PR) | Vitest |
| **Worker** | Outbox com falhas simuladas, backoff, reprocessamento; automações com proteção de laço | Vitest + Redis em container |
| **E2E web** | Login; aprovar desconto; aprovar cliente; kanban/ganho de oportunidade; proposta → pedido; importação | Playwright |
| **E2E mobile** | Criar pedido offline → reconectar → enviado; cliente novo offline; revogação apaga dados | Maestro |
| **IA** | Evals de assistente e mapeamento antes de trocar modelo/prompt; testes de ferramentas com respostas simuladas | Script de eval |

- **CI bloqueia merge** em falha de qualquer suíte de PR.
- Não há meta global de cobertura. A exigência é cobertura alta em `packages/domain` e nos módulos de sincronização e permissão.
- Dados de teste sintéticos; **nunca** dados reais de clientes em fixtures (as respostas gravadas do Sankhya são anonimizadas).

---

## 16. Migração e implantação

1. **Fase 0/1 em staging** com homologação Sankhya.
2. **Piloto da Fase 1**: 3 a 5 representantes e 1 a 2 vendedores internos usando o Sales Force **em paralelo** ao Vidya por 2 a 4 semanas; comparação de pedidos e preços.
3. **Critérios para desligar o Vidya:**
   - zero divergência de preço nos pedidos do piloto;
   - falhas de integração < 1%;
   - todos os usuários treinados e com carga inicial concluída.
4. **Fase 2:** migração do Agendor em staging → validação por amostragem com gestores → carga em produção num fim de semana → Agendor em somente leitura por 30 dias → desligamento.
5. Treinamento: vídeos curtos por fluxo + conteúdo de ajuda alimentando o assistente (F3).

---

## 17. Riscos e pontos a validar

| Risco | Impacto | Mitigação |
|---|---|---|
| API Sankhya com limites/serviços diferentes do esperado | Alto | Spike na Fase 0 antes de qualquer tela; `SankhyaGateway` isola mudanças |
| Regra de preço do Sankhya mais complexa que "tabela por cliente" | Alto | Mapeamento no spike; `packages/domain` testado contra casos reais |
| Sincronização offline com bugs (duplicidade, dados de outra carteira) | Alto | Idempotência, testes de sincronização e permissão, piloto em paralelo |
| **Sem 2FA** com representantes PJ | Médio | Senha forte, bloqueio, revogação e limpeza remota, bloqueio após 7 dias offline, auditoria; reavaliar após incidentes |
| Escopo grande para um desenvolvedor | Alto | Fases com entregáveis que desligam ferramentas; YAGNI em cada fase |
| Custos de IA crescendo | Médio | Teto por usuário, logs de custo, cálculos estatísticos antes da IA, Batch API |
| Formato de exportação do Agendor | Médio | Validar a exportação/API do Agendor no início da Fase 2 |
| Distribuição privada iOS | Baixo | Validar a conta Apple Business Manager antes do piloto |

**Pendências de validação** (não são decisões em aberto; são levantamentos com responsável e prazo de fase):
- **[F0]** Spike Sankhya: entregáveis §11.
- **[F0]** Parâmetros iniciais: limites de desconto por perfil, dias de atraso que bloqueiam pedido, TOP e empresa padrão.
- **[F2]** Funis e etapas atuais do Agendor e motivos de perda.
- **[F3]** Escolha do provedor de telefonia/VoIP.
