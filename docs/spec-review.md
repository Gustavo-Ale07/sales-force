# Revisão crítica da especificação — Sales Force

> **Base revisada:** `docs/project-spec.md` (baseline aprovada em 2026-09-16)
> **Objetivo:** achar inconsistências, riscos técnicos, contradições, decisões prematuras e pontos que exigem spike, **antes** de qualquer código.
> **Regra:** nenhum item altera escopo sem decisão explícita do dono do projeto.

## Legenda

**Tipo**
- 🟥 **DECISÃO**: precisa de decisão sua (muda comportamento, custo, escopo ou stack aprovada).
- 🔬 **SPIKE**: só dá para resolver com investigação prática; o resultado pode gerar decisão.
- ⚙️ **DETALHE**: detalhe de implementação; entra na versão final como regra técnica, sem mudar escopo.

**Severidade**
- **Crítica**: pode invalidar a arquitetura ou gerar erro financeiro ou vazamento.
- **Alta**: retrabalho grande.
- **Média**: retrabalho localizado.
- **Baixa**: higiene.

---

## A. Sincronização offline

### R01 · `change_seq` pula registros em transações concorrentes — Crítica · ⚙️
- **Afeta:** §9.1 (`change_seq` via sequência global + trigger), §10.1.
- **Problema:** o número da sequência é reservado quando a linha é escrita, não quando a transação confirma. Se a transação A reserva 100 e confirma depois da transação B, que reservou 101, um aparelho que já leu até 101 nunca recebe o 100.
- **Impacto:** perda silenciosa de dados no aparelho, como um título ou uma mudança de preço que nunca chega. Esse tipo de bug quase não se reproduz.
- **Recomendação:** o pull só entrega registros com `change_seq` abaixo de uma **marca d'água segura**, calculada a partir das transações ainda abertas no Postgres (snapshot `xmin`). Alternativa: uma única tarefa serializada atribui `change_seq`. Deve haver teste de integração com transações concorrentes.

### R02 · Reconciliação noturna faria todos os aparelhos baixarem tudo todo dia — Alta · ⚙️
- **Afeta:** RF-SNK-2, §9.1.
- **Problema:** a reconciliação completa regrava as tabelas espelhadas. Com trigger em toda escrita, todas as linhas ganham `change_seq` novo mesmo sem mudança real.
- **Impacto:** a sincronização incremental vira carga completa diária, estourando a meta de < 30 s e o consumo de dados móveis.
- **Recomendação:** upsert do espelho **só quando o conteúdo mudou**, comparando um hash das colunas relevantes. O trigger só avança `change_seq` quando houver diferença.

### R03 · Mudança de escopo não se propaga pelo `change_seq` das linhas filhas — Crítica · ⚙️
- **Afeta:** §10.1 ("registro de mudanças de atribuição"), §9.3.
- **Problema:** quando uma conta muda de carteira, só a linha da conta muda. Títulos, pedidos, contatos e histórico dela não mudam, então:
  - o novo dono não recebe esses dados, porque o `change_seq` deles é antigo;
  - o antigo dono não recebe as remoções.
  
  O mesmo acontece com mudanças de perfil, de equipe e de regra de tabela de preço.
- **Impacto:** a carteira fica incompleta para quem recebeu e com **dados indevidos** para quem perdeu. Isso é vazamento no caso dos representantes PJ.
- **Recomendação:** sincronização organizada em **pacotes por conta**.
  - Um log de escopo (`scope_events`) registra "conta X entrou ou saiu do escopo do usuário U".
  - Ao entrar, o servidor envia o pacote completo da conta. Ao sair, envia um comando de remoção do pacote inteiro.
  - Mudança de perfil, equipe ou regra de preço dispara **ressincronização completa** do usuário.

### R04 · Janela deslizante de dados não gera remoções — Média · ⚙️
- **Afeta:** §9.3 ("pedidos últimos 90 dias", "histórico 12 meses", "tarefas 30 dias").
- **Problema:** dados que envelhecem e saem da janela não mudam no servidor, então nunca chegam como removidos.
- **Impacto:** o banco local só cresce, ficando lento e grande.
- **Recomendação:** limpeza **local por data** a cada sincronização. O servidor só envia remoções de fato.

### R05 · Regra de conflito "por campo, `updated_at` mais recente" é inviável como escrita — Alta · ⚙️
- **Afeta:** §10.3.
- **Problema:**
  - `updated_at` é por linha, não por campo;
  - o relógio do aparelho não é confiável;
  - comparar datas de aparelhos diferentes decide errado.
- **Impacto:** perda de edições ou sobrescrita incorreta.
- **Recomendação:**
  - comandos de edição enviam **só os campos alterados** e a **versão base** da linha;
  - o servidor aplica na ordem de chegada;
  - se o campo mudou no servidor depois da versão base, vale a última chegada e o conflito fica na auditoria;
  - para campos críticos (etapa, responsável, status), o comando é rejeitado com motivo.
  
  Datas de negócio usam a hora do servidor (`received_at`).

### R06 · Dependência entre comandos offline não está definida — Alta · ⚙️
- **Afeta:** §10.2.
- **Problema:** um fluxo comum é cadastrar cliente novo offline, criar pedido para ele e registrar uma tarefa. Se o cadastro for rejeitado, o que acontece com o pedido e a tarefa?
- **Impacto:** pedidos órfãos ou erros sem explicação.
- **Recomendação:**
  - comandos processados **em ordem por aparelho**;
  - cada comando declara de quem depende;
  - se o comando pai for rejeitado, os dependentes voltam como bloqueados, com o motivo do pai;
  - pedido de cliente pendente segue RF-ACC-5.
  
  Também falta regra para cliente **rejeitado** com pedido aguardando: proposta é cancelar o pedido com o motivo e notificar o vendedor.

### R07 · Edição de pedido enquanto aguarda aprovação — Média · ⚙️
- **Afeta:** RF-ORD-4, RF-ORD-5.
- **Problema:** o vendedor pode editar offline um pedido que o gerente aprova na web ao mesmo tempo. O spec não diz quais estados permitem edição.
- **Impacto:** pedido aprovado com itens diferentes dos que o gerente viu.
- **Recomendação:**
  - edição permitida só em `rascunho`, `reprovado` e `revisao_preco`;
  - editar um pedido `aguardando_aprovacao` o devolve a `rascunho` e cancela o pedido de aprovação, validando a versão;
  - se o pedido já foi aprovado ou enviado quando a edição chega, a edição é rejeitada;
  - **qualquer mudança em itens invalida uma aprovação anterior**;
  - aprovações só acontecem online.

### R08 · Rascunhos existem só no aparelho? — Média · 🟥 DECISÃO
- **Afeta:** §7 da Seção 2 aprovada ("rascunho (local)"), RF-ORD-1.
- **Problema:** se o rascunho não sobe ao servidor, perder, roubar ou revogar o aparelho apaga o trabalho em andamento, e o vendedor não continua na web.
- **Impacto:** perda de trabalho e retrabalho com o cliente.
- **Recomendação:** rascunhos **sincronizados** com o servidor. Continuam editáveis offline e ficam visíveis ao próprio vendedor na web e ao gerente.

### R09 · Idempotência com três identificadores diferentes — Baixa · ⚙️
- **Afeta:** §9.2 (`orders.idempotency_key`), §10.2 (`command_id`, `entity_id`), RF-SNK-4.
- **Problema:** três nomes para conceitos que se sobrepõem.
- **Impacto:** confusão e implementação inconsistente.
- **Recomendação:** três papéis claros:
  - `command_id`: idempotência do push app → servidor;
  - `entity_id` (UUIDv7): identidade do registro;
  - `outbox.idempotency_key`: servidor → Sankhya, derivada de `entity_id` + tipo + versão.

### R10 · Banco local do app precisa de estratégia de migração própria — Alta · ⚙️
- **Afeta:** §9.3, §14 (EAS Update).
- **Problema:** uma atualização OTA pode trazer um schema local novo. Migrar SQLite com dados pendentes é arriscado, e apagar o banco perde a fila de envio.
- **Impacto:** pedidos não enviados perdidos após uma atualização.
- **Recomendação:**
  - tabelas de **cache** são descartáveis: se a versão do schema mudar, apaga e ressincroniza;
  - **outbox e rascunhos** são as únicas tabelas migradas com cuidado, com testes;
  - o app **envia a fila antes** de aplicar a migração;
  - a atualização fica bloqueada enquanto a fila não esvaziar, exceto se estiver offline por muito tempo; nesse caso migra só outbox e rascunhos.

### R11 · Versão mínima com OTA — Média · ⚙️
- **Afeta:** §10.1, §14.
- **Problema:** com OTA, a "versão do app" é binário + bundle JS. A versão mínima baseada só no binário não cobre isso.
- **Impacto:** app com protocolo incompatível continua sincronizando.
- **Recomendação:**
  - versão do **protocolo de sync** explícita, enviada no cabeçalho, independente das versões de binário e bundle;
  - o servidor aceita **N e N-1**;
  - o painel mostra quantos aparelhos estão em cada versão, porque representantes offline demoram a atualizar.

### R12 · Metas de desempenho sem volume real — Alta · 🔬 SPIKE
- **Afeta:** §1.3 (< 30 s), §13 (carga inicial < 5 min; buscas < 300 ms).
- **Problema:** não sabemos o tamanho real:
  - da carteira por representante;
  - de preços por cliente (produtos × tabelas × exceções);
  - do histórico de itens.
  
  SQLCipher adiciona custo, e busca por texto em 20 mil produtos precisa de FTS.
- **Impacto:** metas irreais e sincronização lenta em celulares simples.
- **Recomendação:** **spike S7** (§K) com dados sintéticos no volume real, em um **Android de entrada** e medindo carga inicial, incremental, busca e tamanho do banco. As metas passam a valer depois da medição.

---

## B. Segurança dos representantes PJ

### R13 · Sem 2FA, nada impede login de outro aparelho — Crítica · 🟥 DECISÃO
- **Afeta:** D16, RF-IAM-7, §12.1.
- **Problema:** com só a senha (fraca, vazada ou compartilhada), qualquer pessoa entra de qualquer aparelho ou navegador e baixa a carteira inteira. A revogação só age depois de descoberto o problema.
- **Impacto:** vazamento de carteira, títulos e crédito para concorrente, justamente o risco que motivou as restrições de PJ.
- **Recomendação:** **vínculo de aparelho com aprovação**, controle que compensa a falta de 2FA com pouco atrito:
  - o primeiro login num aparelho novo fica **pendente** até admin ou gerente aprovar;
  - no máximo **1 aparelho ativo** por representante PJ (configurável);
  - sem aprovação, nenhum dado é enviado.
  
  Continua sem 2FA.

### R14 · Representante PJ na web anula as restrições do app — Alta · 🟥 DECISÃO
- **Afeta:** §2 (PJ no app mobile), matriz §8.2, RF-DSH-6.
- **Problema:** o spec não proíbe o PJ de usar a web. Na web não há vínculo de aparelho nem limpeza remota, e copiar, imprimir e automatizar leitura é trivial.
- **Impacto:** as proteções do app ficam inúteis.
- **Recomendação:** **PJ só no app mobile**, com login web bloqueado para o perfil. Importações que o PJ faz (pedido por planilha, clientes em lote) passam a ser feitas **no app**, ou pelo vendedor interno ou gerente em nome dele.

### R15 · "Revogação imediata" não é imediata — Alta · ⚙️
- **Afeta:** RF-IAM-7, §12.1 (JWT de 15 min).
- **Problema:**
  - um access token JWT continua válido até expirar;
  - a limpeza do banco local só acontece quando o aparelho conecta;
  - o aparelho pode ficar offline de propósito.
- **Impacto:** a expectativa de "imediato" não se cumpre, e o dono do projeto precisa saber o risco real.
- **Recomendação:**
  - validar a **versão da sessão** em toda requisição (consulta barata nesta escala), o que torna a revogação online imediata;
  - documentar que a limpeza é **best effort**: um aparelho que nunca mais conectar mantém os dados, criptografados, até o bloqueio por falta de sincronização (R16).

### R16 · Bloqueio de 7 dias depende do relógio do aparelho — Média · ⚙️
- **Afeta:** RF-IAM-8.
- **Problema:** basta atrasar a data do celular para contornar o bloqueio.
- **Impacto:** o controle compensatório deixa de funcionar.
- **Recomendação:**
  - guardar a hora do servidor da última sincronização;
  - detectar quando o relógio do aparelho volta no tempo e bloquear;
  - usar o tempo desde o boot como sinal extra.
  
  Mesmo assim é mitigação, não garantia.

### R17 · Deduplicação por CNPJ revela clientes de outra carteira — Média · ⚙️
- **Afeta:** RF-ACC-6.
- **Problema:** "mostra a conta existente" diz ao PJ que aquela empresa é cliente e de quem.
- **Impacto:** vazamento de informação comercial.
- **Recomendação:**
  - para quem não tem a conta no escopo, só mostrar "este documento já está cadastrado" e o botão "solicitar ao gerente";
  - sem nome do dono e sem dados;
  - limite de consultas por usuário por dia para impedir enumeração.

### R18 · Base de conhecimento da IA pode expor política interna ao PJ — Média · ⚙️
- **Afeta:** RF-IA-1, §6.2.
- **Problema:** documentos de política comercial podem conter margens, limites de desconto de outros perfis ou estratégia.
- **Impacto:** vazamento pelo assistente.
- **Recomendação:** cada documento da base de conhecimento tem os **perfis que podem vê-lo**, e a recuperação de trechos filtra pelo perfil.

### R19 · Dados do app em backups do sistema do celular — Média · ⚙️
- **Afeta:** §12.2.
- **Problema:** o backup automático do Android e o iCloud podem copiar o banco e os arquivos (PDFs, planilhas).
- **Impacto:** cópia de dados fora do controle da revogação.
- **Recomendação:**
  - excluir banco e arquivos do backup do sistema;
  - PDFs gerados em diretório temporário, apagados após compartilhar;
  - chave do SQLCipher sem sincronização com iCloud Keychain.

---

## C. Integração Sankhya

### R20 · Autenticação descrita está obsoleta — Alta · ⚙️
- **Afeta:** §1.4, §11 ("appkey/token").
- **Problema:** o gateway Sankhya passou a usar **OAuth 2.0 Client Credentials** (`client_id`/`client_secret` + `X-Token`), substituindo o modelo appkey + token.
- **Impacto:** implementar o modelo antigo é retrabalho imediato.
- **Recomendação:** atualizar o spec para OAuth 2.0 com token em cache e renovação automática. As credenciais vêm do Portal do Desenvolvedor e da tela de configurações do gateway no Sankhya Om.

### R21 · Duas APIs possíveis para pedidos — Alta · 🔬 SPIKE
- **Afeta:** §11, RF-SNK-3.
- **Problema:** existem a API REST v1 (`/v1/vendas/pedidos`, com consulta de pedidos e de status) e os serviços do gateway (`CACSP.incluirNota`, `CRUDServiceProvider.loadRecords`). Elas diferem em campos, validações e confirmação.
- **Impacto:** escolher errado custa reescrever o conector.
- **Recomendação:** o spike S1 decide qual API usar para cada operação, com critérios:
  - suporte a campos adicionais (R23);
  - confirmação;
  - consulta incremental;
  - mensagens de erro.
  
  O `SankhyaGateway` isola a escolha.

### R22 · Limites de requisição, custo e homologação desconhecidos — Alta · 🔬 SPIKE
- **Afeta:** §11, RF-SNK-1, §14 (staging na homologação).
- **Problema:**
  - a documentação pública não informa limites de requisição;
  - não se sabe se o contrato cobra por integração ou por usuário de API;
  - não se sabe se existe ambiente de homologação no Sankhya Cloud.
- **Impacto:** frequências do espelho inviáveis, custo inesperado, ou staging apontando para produção.
- **Recomendação:** perguntar ao **executivo/parceiro Sankhya** antes do spike (é comercial, não técnico) e medir no spike. Se não houver homologação, staging usa o `SankhyaGateway` falso com respostas gravadas mais uma base de teste acordada com o parceiro. **Nunca escrever em produção a partir de staging.**

### R23 · Idempotência via "observação" é frágil — Crítica · 🟥 DECISÃO
- **Afeta:** RF-SNK-4, §11.
- **Problema:** a observação é editável por usuários do Sankhya e não é indexada. Se o worker cair depois de o Sankhya aceitar o pedido e antes de gravar o NUNOTA, a nova tentativa pode **duplicar o pedido**.
- **Impacto:** pedido duplicado e faturado duas vezes. Isso viola o critério de "zero duplicados".
- **Recomendação:** criar **campos adicionais** no dicionário de dados do Sankhya (ex.: `AD_SFID` em `TGFCAB` e `TGFPAR`, com índice), preenchidos na inclusão e consultados antes de qualquer nova tentativa. Exige **autorização para customizar o Sankhya**, provavelmente com apoio do parceiro.

### R24 · Pedido criado pela API nasce pendente de confirmação — Alta · 🔬 SPIKE
- **Afeta:** RF-ORD-4 (`enviado` → `faturado`).
- **Problema:** a documentação indica que pedidos criados pela API ficam **pendentes de confirmação**. O spec não diz quem confirma nem como: confirmar pela API, confirmar manualmente no Sankhya, ou regra da TOP.
- **Impacto:** pedidos parados no ERP sem ninguém perceber, e status errado no app.
- **Recomendação:** o spike S3 mapeia o ciclo real: inclusão → confirmação → faturamento. Com isso, os estados passam a ser `enviado` (incluído), `confirmado`, `faturado`, `faturado_parcial` e `cancelado`, e fica definido quem confirma.

### R25 · Faturamento parcial e vínculo pedido → nota — Alta · 🔬 SPIKE
- **Afeta:** RF-ORD-4, RF-ORD-7, RF-DSH-1.
- **Problema:** o pedido de venda é faturado em **outra nota** (outro NUNOTA, com vínculo entre documentos), e pode ser faturado em partes ou ter itens cortados. O spec trata como um só documento.
- **Impacto:** status e dashboards de faturamento errados, e comissões não batem.
- **Recomendação:** o spike S3 mapeia o vínculo pedido → notas. O modelo passa a ter `sales_documents` com relação de origem e o estado `faturado_parcial`. Dashboards de faturamento usam **notas**, não pedidos.

### R26 · Liberação de limites nativa do Sankhya × alçada do Sales Force — Crítica · 🟥 DECISÃO (após spike)
- **Afeta:** RF-ORD-3, RF-ORD-5, RF-CAT-3, D21.
- **Problema:** o Sankhya tem **eventos de liberação de limites** nativos (desconto, crédito, preço mínimo etc.) que podem ser disparados no pedido. Se o Sales Force aprova e o Sankhya exige nova liberação, há **aprovação dupla**. Se o Sankhya tiver desconto máximo por produto ou vendedor menor que o do Sales Force, o pedido aprovado trava no ERP.
- **Impacto:** pedidos aprovados que não andam e regras divergentes.
- **Recomendação:** fonte única de aprovação.
  - **Proposta:** o Sales Force é a fonte da alçada de desconto e da exceção de crédito, e pedidos originados nele usam uma **TOP dedicada** configurada para não gerar esses eventos (ou gerá-los já liberados).
  - O spike S4 confirma se isso é possível. Se não for, a alternativa é usar a liberação nativa e o Sales Force só exibe o status.

### R27 · Cadastro de parceiro exige dados que o formulário não coleta — Alta · 🔬 SPIKE
- **Afeta:** RF-ACC-3, RF-ACC-4.
- **Problema:** o parceiro no Sankhya costuma exigir:
  - cidade, bairro e logradouro **codificados** (tabelas próprias, não texto);
  - inscrição estadual e indicador de contribuinte de ICMS;
  - classificação fiscal e regime;
  - vendedor, tabela de preço, perfil e região.
- **Impacto:** clientes aprovados falham na criação e o fluxo de aprovação vira retrabalho manual.
- **Recomendação:** o spike S5 lista os campos obrigatórios do parceiro na configuração da empresa. O formulário do app coleta os dados comerciais, a **aprovação** completa os fiscais, e a conversão de CEP em códigos do Sankhya é feita no servidor.

### R28 · Metas e comissões podem não existir "prontas" — Média · 🔬 SPIKE
- **Afeta:** RF-GOL-1..3, D6.
- **Problema:** as tabelas de metas e comissões não foram identificadas. As comissões podem ser apuradas só no fechamento, e positivação pode não existir como dado.
- **Impacto:** a promessa da Fase 1 (paridade com o Vidya) pode não ter fonte.
- **Recomendação:** o spike S6 descobre onde estão e com que atualização. **Positivação** pode ser calculada no Sales Force a partir das notas (é contagem simples) sem violar D6. Se as comissões só existirem no fechamento, mostrar "apurado até o último fechamento".

### R29 · Exclusões e leituras incrementais — Média · 🔬 SPIKE
- **Afeta:** RF-SNK-1, RF-SNK-2.
- **Problema:** nem toda tabela tem data de alteração confiável, e exclusões não aparecem em consultas incrementais. A reconciliação diária de dezenas de milhares de registros pela API pode ser lenta.
- **Impacto:** espelho com dados apagados ainda visíveis e reconciliação estourando a janela da madrugada.
- **Recomendação:** o spike S1 mede isso por entidade. Opções:
  - consulta de chaves (só IDs) para detectar exclusões;
  - reconciliação em rodízio por partes ao longo da semana;
  - para preços, verificação completa mais frequente, por serem críticos.

---

## D. Resolução de preços

### R30 · Impostos (IPI/ICMS-ST) ausentes — Crítica · 🟥 DECISÃO
- **Afeta:** RF-ORD-1, RF-ORD-10, RF-PRP-1..6, §1 (indústria).
- **Problema:** na indústria, IPI e ICMS-ST mudam muito o valor final para o cliente. O Sankhya calcula impostos pela configuração fiscal (a API de pedido calcula totais sozinha), mas **offline o app não tem como calcular** com fidelidade. Orçamentos e propostas sem impostos mostram um total que não é o cobrado.
- **Impacto:** cliente aceita um valor e recebe nota maior, com atrito comercial e cancelamentos.
- **Recomendação:**
  - app e proposta mostram o **valor dos produtos** (sem impostos) e um aviso claro;
  - quando online, o servidor pede ao Sankhya a **simulação de impostos**, se o spike S2 confirmar que é possível, e mostra o total com impostos;
  - o pedido enviado recebe os totais reais do Sankhya.
  
  **Decisão:** esse comportamento é aceitável? Proposta com impostos passa a exigir conexão?

### R31 · Regra de preço do Sankhya pode ser mais que "tabela por cliente" — Crítica · 🔬 SPIKE
- **Afeta:** RF-CAT-2, D4.
- **Problema:** o preço no Sankhya pode depender de:
  - empresa, TOP e tipo de negociação (condição de pagamento com acréscimo ou desconto);
  - exceções por parceiro ou produto;
  - faixa de quantidade;
  - região;
  - tabela vinculada ao parceiro;
  - preço mínimo e desconto máximo no produto.
- **Impacto:** preço do app diferente do Sankhya, que é exatamente o risco central do projeto.
- **Recomendação:** o spike S2 mapeia a regra **da configuração real da empresa** e grava 50 a 100 casos reais (cliente, produto, quantidade, condição → preço do Sankhya). Esses casos viram **testes de aceitação** de `packages/domain`. Critério para liberar o piloto: 100% dos casos batendo.

### R32 · Precisão numérica e arredondamento — Alta · ⚙️
- **Afeta:** §9.1 (`numeric(14,2)` para dinheiro), `packages/domain`.
- **Problema:**
  - preços unitários no ERP costumam ter mais de 2 casas decimais;
  - JavaScript usa ponto flutuante;
  - a regra de arredondamento (por item ou no total) precisa ser igual à do Sankhya.
- **Impacto:** diferenças de centavos que disparam `revisao_preco` falsa ou divergência de total.
- **Recomendação:**
  - preços unitários e percentuais com **6 casas** (`numeric(18,6)`), totais com 2;
  - aritmética decimal exata em `packages/domain`, nunca `number` para dinheiro;
  - regra de arredondamento definida pelo spike S2 e coberta por testes.

### R33 · Snapshot de preço insuficiente para detectar revisão — Média · ⚙️
- **Afeta:** RF-ORD-6, `order_items.price_snapshot_at`.
- **Problema:** para comparar "preço antigo × novo" é preciso saber **qual** tabela e versão foram usadas, não só a data.
- **Impacto:** revisão disparada errado, ou não disparada.
- **Recomendação:** o item guarda tabela, preço de tabela usado e versão/`change_seq` da linha de preço. O servidor compara com o preço vigente. Diferença abaixo da tolerância de arredondamento não dispara revisão.

### R34 · Preço de proposta para lead (sem cadastro no Sankhya) — Média · ⚙️
- **Afeta:** RF-PRP-1, RF-ACC-7.
- **Problema:** lead não tem vínculo com tabela de preço nem região no Sankhya.
- **Impacto:** proposta sem preço ou com preço arbitrário.
- **Recomendação:** **tabela padrão configurável por UF**, e a revisão de preço é obrigatória quando o lead vira cliente e a proposta vira pedido.

---

## E. Aprovação de descontos e crédito

### R35 · Base de cálculo da alçada não definida — Alta · 🟥 DECISÃO
- **Afeta:** RF-CAT-3, RF-ORD-5.
- **Problema:** o limite vale para o **maior desconto de um item**, para o **desconto médio ponderado do pedido**, ou para os dois? Falta ainda definir se existe desconto no cabeçalho do pedido.
- **Impacto:** regra central do dinheiro implementada de forma diferente do que a diretoria espera.
- **Recomendação:** **maior % de desconto entre os itens** (simples, previsível, comum em força de vendas) e **sem desconto no cabeçalho** no MVP.

### R36 · Roteamento da aprovação e teto — Média · 🟥 DECISÃO
- **Afeta:** RF-CAT-3, RF-ORD-5, matriz §8.2.
- **Problema:** falta definir:
  - acima do limite do gerente, passa pelo gerente antes da diretoria ou vai direto?
  - existe teto absoluto?
  - quem aprova quando o gerente está ausente ou quando o gerente não tem limite?
  - quem aprova pedidos criados pelo próprio gerente?
- **Impacto:** pedidos parados e regras inventadas durante a implementação.
- **Recomendação:**
  - o pedido vai **direto ao nível com alçada suficiente**, e o gerente é notificado;
  - **teto absoluto** configurável (acima dele, bloqueado);
  - pedido do gerente sobe para a diretoria;
  - aprovador substituto configurável por equipe.

### R37 · Quem aprova exceção de crédito — Alta · 🟥 DECISÃO
- **Afeta:** RF-ORD-3, matriz §8.2.
- **Problema:** RF-ORD-3 manda pedidos com títulos vencidos ou acima do crédito "para aprovação", mas a matriz não tem essa permissão. Pedido com desconto **e** crédito precisa de duas aprovações?
- **Impacto:** fluxo indefinido no coração do pedido.
- **Recomendação:**
  - exceção de crédito aprovada pelo **Cadastro/Financeiro**;
  - se houver as duas, ordem fixa: **crédito → desconto**;
  - cada aprovação é registrada separadamente.

### R38 · Crédito disponível offline não enxerga pedidos em trânsito — Média · ⚙️
- **Afeta:** RF-ORD-3.
- **Problema:** o crédito calculado no aparelho ignora:
  - pedidos na fila local;
  - pedidos de outros vendedores para o mesmo cliente;
  - pedidos enviados e ainda não faturados;
  
  E a fórmula do Sankhya (limite − títulos abertos − pedidos pendentes?) é desconhecida.
- **Impacto:** crédito aprovado offline que o Sankhya bloqueia.
- **Recomendação:**
  - offline, a checagem é **indicativa** e desconta os pedidos locais pendentes;
  - a checagem que vale é no servidor, com a mesma fórmula do Sankhya, levantada no spike S4.

---

## F. Identificadores e modelo de dados

### R39 · UUIDv7 × PostgreSQL 16 — Baixa · ⚙️
- **Afeta:** §7.3 ("PostgreSQL 16+"), §9.1.
- **Problema:** `uuidv7()` nativo só existe a partir do PostgreSQL 18.
- **Impacto:** dependência de extensão ou geração só na aplicação.
- **Recomendação:** **PostgreSQL 18**. A geração continua possível no cliente.

### R40 · UUIDv7 usa o relógio do aparelho e revela data de criação — Baixa · ⚙️
- **Afeta:** §9.1.
- **Problema:** relógio errado quebra a ordenação por id, e o id expõe o momento da criação (ex.: em links de proposta).
- **Impacto:** ordenações erradas e pequeno vazamento de informação.
- **Recomendação:**
  - **nunca ordenar regra de negócio por UUID**, usar `received_at`/`created_at` do servidor;
  - links públicos usam token aleatório próprio;
  - o servidor rejeita UUIDv7 com data absurda (mais de 1 dia no futuro).

### R41 · Chaves das tabelas espelhadas — Média · ⚙️
- **Afeta:** §9.2 (tabelas com `sankhya_*`).
- **Problema:** o spec não define se o espelho usa UUID como chave e como se refaz o espelho sem mudar ids, que os aparelhos referenciam.
- **Impacto:** reconstruir o espelho quebraria referências e forçaria ressincronização geral.
- **Recomendação:** UUID **determinístico (v5)** derivado da chave do Sankhya (ex.: `codparc`), com restrição única na chave natural. Reconstruir gera os mesmos ids.

### R42 · Profundidade do histórico no servidor — Média · ⚙️
- **Afeta:** RF-DSH-1, RF-DSH-4, RF-IA-3/4.
- **Problema:** "queda de compra × média anterior", churn e sugestão de mix precisam de histórico. O spec só define profundidade no aparelho.
- **Impacto:** carga histórica refeita depois.
- **Recomendação:** espelho no servidor com **36 meses** de notas e itens, com carga inicial do histórico na Fase 0/1.

### R43 · Fuso horário e datas de negócio — Baixa · ⚙️
- **Afeta:** §9.1.
- **Problema:** vencimentos, "sem comprar há N dias" e metas mensais dependem de fuso.
- **Impacto:** alertas e métricas deslocados em um dia.
- **Recomendação:** `timestamptz` para eventos, `date` para datas de negócio, cálculos em `America/Sao_Paulo`.

---

## G. Expo, SQLCipher e distribuição

### R44 · SQLCipher no Expo: compatibilidade a validar — Alta · 🔬 SPIKE
- **Afeta:** §7.3, §12.2.
- **Problema:**
  - `expo-sqlite` suporta SQLCipher pela opção `useSQLCipher` do config plugin, o que exige build nativo (não funciona no Expo Go);
  - há relato em aberto sobre **páginas de memória de 16 KB no Android** com SQLCipher, que o Google Play passou a exigir;
  - é preciso validar FTS com SQLCipher, o driver Drizzle com banco criptografado e o desempenho.
- **Impacto:** build rejeitado na Play Store ou necessidade de trocar a biblioteca (ex.: `op-sqlite`) no meio da Fase 1.
- **Recomendação:** o spike S7 valida no SDK Expo atual: build de produção, alinhamento de 16 KB, FTS5, Drizzle, migrações e desempenho. `op-sqlite` fica como plano B.

### R45 · Perda da chave do SQLCipher perde a fila — Média · ⚙️
- **Afeta:** §9.3, §12.2.
- **Problema:** se o armazenamento seguro for limpo (troca de biometria, restauração do aparelho), o banco fica ilegível, inclusive a fila de envio.
- **Impacto:** pedidos não enviados perdidos.
- **Recomendação:**
  - enviar a fila de forma agressiva, sempre que houver conexão;
  - se a chave se perder, recriar o banco, ressincronizar e alertar o usuário sobre o que não foi enviado;
  - rascunhos sincronizados (R08) reduzem essa perda.

### R46 · Distribuição Android privada exige gestão de aparelhos — Alta · 🟥 DECISÃO
- **Afeta:** §14 ("Managed Google Play, app privado").
- **Problema:** app privado no Managed Google Play exige **Android Enterprise com EMM** (perfil de trabalho no celular pessoal do PJ, gerenciado por Google Workspace, Intune etc.). Distribuir o APK diretamente esbarra na **verificação de desenvolvedor Android**, obrigatória no Brasil a partir de 30/09/2026.
- **Impacto:** exigir perfil de trabalho em celular pessoal de PJ gera resistência; APK avulso gera fricção e risco.
- **Recomendação:** publicar na **Play Store normal**, com login obrigatório e sem cadastro aberto. É permitido, precisa de conta de desenvolvedor **organizacional** verificada e de credenciais de demonstração para a revisão do Google. Alternativa: Managed Google Play com perfil de trabalho via Google Workspace, se a empresa aceitar gerenciar os aparelhos.

### R47 · Distribuição iOS — Alta · 🟥 DECISÃO (+ preparação imediata)
- **Afeta:** §14 ("Apple Business Manager ou TestFlight").
- **Problema:**
  - **TestFlight não serve para produção**: builds expiram em 90 dias;
  - o app personalizado (custom app) via **Apple Business Manager** exige conta Apple Developer da **organização** (D-U-N-S), ABM configurado e revisão da Apple com conta de demonstração;
  - sem MDM, a distribuição usa **códigos de resgate**, que valem só no país da conta ABM e **não podem ser revogados**;
  - distribuição gerenciada exige MDM.
- **Impacto:** o processo de D-U-N-S e ABM leva semanas e pode atrasar o piloto. Os códigos não revogáveis são aceitáveis, porque o controle real é o login e o aparelho aprovado (R13).
- **Recomendação:** **custom app via ABM com códigos de resgate, sem MDM**. **Iniciar já** o D-U-N-S e as contas organizacionais Apple e Google. Ambiente de demonstração para os revisores com dados fictícios (R62).

### R48 · Desenvolvimento em Windows × iOS e testes mobile — Média · ⚙️
- **Afeta:** §14, §15 (Maestro).
- **Problema:**
  - sem Mac, não há simulador iOS nem build iOS local;
  - Maestro em iOS precisa de macOS;
  - Testcontainers no Windows exige Docker Desktop com WSL2.
- **Impacto:** testes iOS e E2E mobile inviáveis localmente.
- **Recomendação:**
  - builds iOS no EAS (nuvem);
  - E2E mobile no **Android** localmente e no CI, com iOS validado por testes manuais em aparelho físico no piloto;
  - documentar os pré-requisitos (Docker Desktop, WSL2, Android Studio).

---

## H. RBAC e escopo de dados

### R49 · Carteira compartilhada entre representante e vendedor interno — Alta · 🟥 DECISÃO
- **Afeta:** §8.1 (escopo "próprio"), RF-ACC-1.
- **Problema:** na indústria é comum o vendedor interno atender clientes de representantes (reposição, cobrança, pós-venda). Com um único responsável por conta, o interno não vê esses clientes.
- **Impacto:** operação real bloqueada e gerentes pedindo exceções.
- **Recomendação:** a conta tem **1 responsável** (vindo do Sankhya) e **N atendentes adicionais** (definidos no Sales Force pelo gerente). O escopo "próprio" inclui contas em que o usuário é atendente. Atendentes não viram donos no Sankhya.

### R50 · Visibilidade de registros filhos não está definida — Alta · ⚙️
- **Afeta:** §8.1.
- **Problema:** uma tarefa ou oportunidade do usuário A numa conta do usuário B: quem vê? E o gerente de A, se a conta é de outra equipe?
- **Impacto:** vazamentos ou sumiço de registros, com regra diferente em cada endpoint.
- **Recomendação:** regra única. Um usuário vê um registro filho se estiver no escopo:
  - **da conta** (dono ou atendente), **ou**
  - **do próprio registro** (responsável).
  
  Registros da conta herdam da conta: títulos, pedidos, contatos, histórico. Uma função central de política é usada por API, sync, dashboards e IA, com testes de matriz.

### R51 · Hierarquia de um nível só — Média · ⚙️
- **Afeta:** RF-IAM-5.
- **Problema:** "cada equipe tem um gerente" não cobre regional → supervisor → vendedor.
- **Impacto:** refazer o escopo se a estrutura crescer.
- **Recomendação:** modelar **equipes em árvore** desde o início. O escopo "equipe" inclui as subequipes. O escopo funcional não muda.

### R52 · Escopo por recurso, não por perfil — Média · ⚙️
- **Afeta:** matriz §8.2 (Cadastro/Financeiro "tudo, só contas/pendências").
- **Problema:** o modelo "perfil → um escopo" não expressa "vê todas as contas, mas nenhuma oportunidade".
- **Impacto:** exceções espalhadas no código.
- **Recomendação:** o escopo é definido **por permissão de recurso** (ex.: `account.read: tudo`, `opportunity.read: nenhum`).

### R53 · Leads sem responsável — Baixa · ⚙️
- **Afeta:** RF-AUT-2, §8.1.
- **Problema:** leads que ainda não foram distribuídos não têm dono.
- **Impacto:** ninguém os vê, ou todos veem.
- **Recomendação:** ficam num **pool da equipe ou da origem**, visível só a gerentes e admin até a distribuição.

---

## I. Arquitetura, filas e armazenamento

### R54 · Duas apps NestJS (api e worker) duplicam a montagem dos módulos — Média · ⚙️
- **Afeta:** §7.2.
- **Problema:** o worker precisa dos mesmos módulos de domínio e serviços da api. Duas apps separadas duplicam configuração e tendem a divergir.
- **Impacto:** retrabalho e bugs de configuração.
- **Recomendação:** **um único app servidor** (`apps/server`) com dois pontos de entrada (`api` e `worker`), mesma imagem Docker e processos diferentes.

### R55 · Fronteiras do monólito modular não são garantidas — Média · ⚙️
- **Afeta:** §7.2 ("módulos não acessam tabelas uns dos outros").
- **Problema:** com um único schema Drizzle, nada impede importar tabelas de outro módulo. E dashboards precisam ler de vários módulos.
- **Impacto:** as fronteiras se desfazem em poucas semanas.
- **Recomendação:**
  - schema organizado **por módulo**;
  - regra de lint de dependências verificada no CI;
  - **exceção explícita**: o módulo de relatórios lê por **views SQL** somente leitura.

### R56 · BullMQ/Redis adiciona um componente e uma escrita dupla — Alta · 🟥 DECISÃO
- **Afeta:** §7.1, §7.3, RF-SNK-3.
- **Problema:**
  - gravar o pedido no Postgres e enfileirar no Redis são duas escritas: se uma falhar, o job se perde ou é criado sem o registro;
  - o Redis precisa de persistência e política `noeviction`, senão jobs somem;
  - é mais um serviço para operar, monitorar e fazer backup numa VPS mantida por uma pessoa.
- **Impacto:** perda silenciosa de envios ao Sankhya e mais operação.
- **Recomendação:** trocar por **pg-boss** (fila no próprio PostgreSQL): enfileira na **mesma transação** da regra de negócio, tem agendamentos, tentativas e concorrência, e elimina o Redis. Nesta escala (≤ 100 usuários) o desempenho sobra. Rate limit e cache ficam no Postgres ou em memória.

### R57 · MinIO Community não é mais mantido — Crítica · 🟥 DECISÃO
- **Afeta:** §7.1, §7.3, §14.
- **Problema:** o repositório do MinIO Community foi **arquivado em 2026**, e desde outubro de 2025 não há binários nem imagens oficiais. A imagem `minio/minio` do Docker Hub não existe mais.
- **Impacto:** componente sem correções de segurança e imagens indisponíveis. Isso **inviabiliza a escolha**.
- **Recomendação:** **armazenamento S3 gerenciado e externo à VPS**, como Cloudflare R2, Backblaze B2 ou Hetzner Object Storage. Custo baixo e, de brinde, os arquivos ficam fora da VPS e o mesmo provedor guarda os backups (R63). Alternativa self-hosted mantida: Garage ou SeaweedFS.

### R58 · Next.js + NestJS = dois servidores Node sem necessidade de SSR — Média · 🟥 DECISÃO (opcional)
- **Afeta:** §7.3.
- **Problema:** é um sistema interno autenticado, sem SEO. O Next.js App Router acrescenta renderização no servidor, repasse de cookies para a API, mais um processo em produção e variáveis embutidas no build (imagem diferente para staging e produção).
- **Impacto:** complexidade sem benefício para este produto.
- **Recomendação:** **SPA React com Vite** (React Router ou TanStack Router + TanStack Query), servida como arquivos estáticos pelo Caddy no **mesmo domínio** da API (`/api`), com cookie de sessão sem CORS. Se preferir manter o Next.js, o custo é aceitável; é decisão de gosto e maturidade da equipe.

### R59 · E-mail transacional não definido — Média · ⚙️
- **Afeta:** RF-IAM-3 (redefinição de senha, Fase 0), RF-AUT-4, RF-NOT-3, RF-SNK-7.
- **Problema:** o spec só prevê o Gmail do usuário (Fase 2). A Fase 0 já precisa enviar e-mail do sistema.
- **Impacto:** a Fase 0 fica bloqueada.
- **Recomendação:** provedor de e-mail transacional (ex.: Amazon SES, Resend ou Postmark) com domínio verificado (SPF, DKIM, DMARC). Alternativa: relay SMTP do Google Workspace.

### R60 · PDF de orçamento offline × PDF no worker — Média · ⚙️
- **Afeta:** RF-ORD-10 (Fase 1, a partir do app), §7.3 (PDF com Playwright no worker).
- **Problema:** offline o app não alcança o worker. Dois motores de PDF divergem visualmente.
- **Impacto:** orçamento offline impossível ou com aparência diferente.
- **Recomendação:**
  - **template HTML único** em pacote compartilhado;
  - no app, gerado localmente com `expo-print`;
  - no servidor (propostas, e-mail), gerado com Chromium headless;
  - sem imagens remotas no template, com logo embutido.

---

## J. Migrations, observabilidade, backups e deploy

### R61 · Migrations "automáticas no deploy" — Alta · ⚙️
- **Afeta:** §14.
- **Problema:**
  - rodar migrations ao subir cada contêiner causa corrida entre processos;
  - não há regra para triggers e SQL escrito à mão (`change_seq`, views), que Drizzle Kit não gera sozinho;
  - o "expandir → contrair" precisa considerar **apps offline em versões antigas** por dias.
- **Impacto:** deploy quebrado ou apps antigos falhando na sincronização.
- **Recomendação:**
  - migrations SQL **geradas, revisadas e versionadas** (nunca `push` em produção), executadas por um **job único** antes de subir a nova versão, com lock;
  - SQL manual permitido como migration própria;
  - a fase de **contração** só acontece depois que o painel de versões (R11) mostrar zero aparelhos no protocolo antigo;
  - migrations de dados (ex.: importação do Agendor) ficam **fora** das migrations de schema.

### R62 · Ambientes: staging compartilhando a VPS de produção — Média · 🟥 DECISÃO
- **Afeta:** §14.
- **Problema:** o spec não diz se staging e produção dividem a VPS. Se dividem:
  - um teste de carga ou migração em staging derruba produção;
  - segredos e redes ficam próximos demais.
  
  Além disso, as lojas precisam de um **ambiente de demonstração** estável para revisão.
- **Impacto:** risco de indisponibilidade e de misturar dados.
- **Recomendação:** **VPS separada e menor para staging**, com custo baixo. O staging hospeda também a conta de demonstração para a revisão da Apple e do Google, com dados fictícios.

### R63 · Backups incompletos e RPO ambíguo — Alta · ⚙️
- **Afeta:** §12.3, §13 ("RPO ≤ 24 h com WAL para reduzir").
- **Problema:**
  - o RPO é ambíguo;
  - arquivos, configuração e segredos estão fora do plano;
  - não se fala em criptografar os backups, que contêm dados pessoais;
  - "restauração mensal" é manual.
  
  Dados do CRM e comandos recebidos dos aparelhos **só existem no Sales Force**.
- **Impacto:** perda de até um dia de CRM e aprovações, ou restauração que falha na hora H.
- **Recomendação:**
  - **arquivamento contínuo de WAL** (pgBackRest ou WAL-G) para S3 externo: **RPO ≤ 15 min**, com recuperação para um ponto no tempo;
  - backups criptografados, com retenção de 30 dias;
  - arquivos já ficam em S3 externo, com versionamento ativado;
  - segredos em cofre ou arquivo criptografado fora da VPS;
  - **teste de restauração automatizado mensal** numa instância temporária, com relatório.

### R64 · Recuperação de desastre da VPS — Média · ⚙️
- **Afeta:** §13 (RTO ≤ 4 h).
- **Problema:** RTO de 4 h com reconstrução manual da VPS é otimista.
- **Impacto:** indisponibilidade longa, já que representantes offline continuam trabalhando mas não enviam nada.
- **Recomendação:** provisionamento **reproduzível** (script de inicialização ou Ansible + Compose versionado) e **runbook** testado uma vez antes do piloto.

### R65 · Observabilidade: sem métricas de negócio e com dados pessoais no Sentry — Média · ⚙️
- **Afeta:** §14.
- **Problema:**
  - faltam métricas que importam: atraso do espelho, tamanho e idade da fila, duração do pull e do push, falhas por aparelho, distribuição de versões do app, custos de IA;
  - o Sentry pode capturar corpo de requisição com nomes, CNPJ e valores;
  - logs em Docker sem retenção nem busca.
- **Impacto:** problemas de sincronização invisíveis e envio de dados pessoais a terceiros.
- **Recomendação:**
  - painel interno de saúde (já previsto) ampliado com essas métricas;
  - Sentry com **limpeza de dados pessoais** (sem corpo, sem dados de formulário) ou GlitchTip auto-hospedado;
  - logs com rotação e retenção de 30 dias, com um coletor simples (ex.: Loki + Grafana, ou serviço gerenciado);
  - alerta para fila parada, espelho atrasado e erro de backup.

### R66 · Deploy com Docker Compose tem indisponibilidade breve — Baixa · ⚙️
- **Afeta:** §14.
- **Problema:** reiniciar contêineres derruba a API por segundos, o que o spec não assume.
- **Impacto:** requisições web falham durante o deploy. O app tolera, porque tenta de novo.
- **Recomendação:**
  - **deploy fora do horário comercial** e aceite explícito de indisponibilidade curta;
  - healthcheck antes de liberar tráfego;
  - rollback = voltar para a imagem anterior, o que é seguro por causa de expandir/contrair.

---

## K. Outros pontos

### R67 · Transferência internacional de dados (LGPD) — Média · 🟥 DECISÃO (jurídica)
- **Afeta:** §6.2, §12.5.
- **Problema:** Anthropic, Sentry, Google, provedor de e-mail e S3 podem processar dados fora do Brasil. A LGPD exige base para transferência internacional (ex.: cláusulas contratuais padrão da ANPD).
- **Impacto:** risco regulatório.
- **Recomendação:** validar com jurídico ou encarregado de dados. Registrar operadores e regiões. Preferir regiões brasileiras ou de adequação quando houver opção. Não bloqueia a Fase 0.

### R68 · Status do documento e referências internas — Baixa · ⚙️
- **Afeta:** cabeçalho, §4.
- **Problema:**
  - o cabeçalho ainda diz "rascunho";
  - há decisões (D15 BullMQ/MinIO, D19) que esta revisão pode alterar;
  - o `.gitignore` do repositório é uma pasta.
- **Impacto:** confusão sobre qual é a fonte da verdade.
- **Recomendação:** a versão final (v1.0) marca a origem de cada mudança (`R##`) e registra as decisões substituídas.

---

## L. Spikes necessários (antes ou no início da Fase 0)

| Spike | Pergunta | Critério de saída | Bloqueia |
|---|---|---|---|
| **S0 Comercial Sankhya** | Limites de requisição, custo de integração, existência de homologação, permissão para campos adicionais (`AD_`) | Respostas por escrito do parceiro/executivo | S1–S6 |
| **S1 API e leituras** | REST v1 × serviços do gateway por operação; OAuth; leitura incremental e detecção de exclusão por entidade | Tabela entidade → método → cursor → exclusão, com tempos medidos | Espelho (F0) |
| **S2 Preço e impostos** | Regra real de preço; arredondamento; simulação de impostos possível? | 50–100 casos reais gravados; decisão R30 fechada | `packages/domain`, pedido (F1) |
| **S3 Ciclo do pedido** | Inclusão → confirmação → faturamento (inclusive parcial) → cancelamento; vínculo pedido → nota | Diagrama de estados validado com um pedido real em homologação | Pedido (F1) |
| **S4 Liberações e crédito** | TOP dedicada sem eventos de liberação? Fórmula de crédito disponível | Decisão R26 fechada | Aprovação (F1) |
| **S5 Cadastro de parceiro** | Campos obrigatórios; endereço codificado; dados fiscais | Lista de campos por etapa (app × aprovação) | Cliente novo (F1) |
| **S6 Metas e comissões** | Onde estão, atualização, granularidade | Fonte por indicador ou plano de cálculo de positivação | Metas (F1) |
| **S7 Mobile offline** | SQLCipher (16 KB), FTS5, Drizzle, desempenho com volume real em Android de entrada | Metas §13 medidas e confirmadas ou revisadas | App (F1) |
| **S8 Distribuição** | Contas organizacionais Apple/Google, D-U-N-S, ABM, verificação de desenvolvedor Android | Build de teste instalado via canal definitivo nas duas plataformas | Piloto (F1) |
| **S9 Agendor** | Formato de exportação/API do Agendor | Amostra exportada e mapeada | Migração (F2) |

S0 e S8 dependem de terceiros e de burocracia, por isso devem começar **imediatamente**, em paralelo.

---

## M. Resumo das decisões necessárias

| # | Tema | Recomendação |
|---|---|---|
| R08 | Rascunhos | Sincronizar com o servidor |
| R13 | Aparelho novo (compensa a falta de 2FA) | Aprovação por admin/gerente; 1 aparelho ativo por PJ |
| R14 | PJ na web | Bloquear; PJ só no app |
| R23 | Customizar o Sankhya (campos `AD_`) | Autorizar |
| R26 | Fonte das aprovações | Sales Force + TOP dedicada (confirmar no S4) |
| R30 | Impostos em orçamento/proposta | Valor sem impostos offline + simulação online (confirmar no S2) |
| R35 | Base da alçada | Maior % de desconto entre itens; sem desconto no cabeçalho |
| R36 | Roteamento e teto | Direto ao nível com alçada; teto absoluto; pedido do gerente sobe para a diretoria |
| R37 | Exceção de crédito | Financeiro aprova; ordem crédito → desconto |
| R46 | Android | Play Store pública com login, conta organizacional |
| R47 | iOS | Custom app ABM + códigos de resgate; iniciar D-U-N-S já |
| R49 | Carteira compartilhada | Responsável + atendentes adicionais |
| R56 | Fila | pg-boss no Postgres (remove Redis) |
| R57 | Armazenamento de arquivos | S3 gerenciado externo (remove MinIO) |
| R58 | Front-end web | SPA React com Vite (opcional) |
| R62 | Staging | VPS separada |
| R67 | LGPD internacional | Validação jurídica (não bloqueia a F0) |

---

**Fontes consultadas**
- [MinIO Community arquivado](https://stormdevelopments.ca/blog/minio-s-community-edition-is-archived-what-still-runs-in-2026/)
- [expo-sqlite: `useSQLCipher`](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Issue 16 KB + SQLCipher](https://github.com/expo/expo/issues/39792)
- [Sankhya OAuth 2.0](https://developer.sankhya.com.br/reference/post_authenticate)
- [Sankhya: incluir pedido de venda](https://developer.sankhya.com.br/reference/addpedido)
- [Sankhya: liberação de limites](https://ajuda.sankhya.com.br/hc/pt-br/articles/360044601034-Libera%C3%A7%C3%A3o-de-Limites)
- [Verificação de desenvolvedor Android](https://android-developers.googleblog.com/2026/06/android-developer-verification.html)
- [Apps privados no Managed Google Play](https://knowledge.workspace.google.com/admin/devices/manage-private-android-apps-in-google-play)
- [Apple: distribuição gerenciada exige MDM](https://support.apple.com/en-us/105125)
- [ABM custom apps sem MDM](https://developer.apple.com/forums/thread/733401)
