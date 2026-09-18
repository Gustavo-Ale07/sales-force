window.STATES = [
 {id:'SM-1', a:'sm-conta', t:'Conta', st:[['A','P-19 — ciclo de vida'],['D','gatilhos RF-ACC'],['U','BP-14']], sec:'s14', cols:5, rows:2,
  nodes:[
   {id:'lead',l:'lead',c:0,r:0,k:'initial',sub:'F2'},
   {id:'prospect',l:'prospect',c:1,r:0,sub:'F2'},
   {id:'pend',l:'cliente_pendente',c:2,r:0,sub:'aguarda backoffice'},
   {id:'cli',l:'cliente',c:3,r:0,k:'final',sub:'parceiro Sankhya'},
   {id:'ina',l:'inativo',c:4,r:0,sub:'reflete o Sankhya'},
   {id:'novo',l:'cadastro direto',c:1,r:1,k:'note',sub:'vendedor / PJ (F1)'},
   {id:'rej',l:'rejeitado',c:2,r:1,k:'bad',sub:'motivo obrigatório'},
   {id:'mir',l:'espelho Sankhya',c:3,r:1,k:'note',sub:'parceiro existente'}
  ],
  edges:[
   {f:'lead',t:'prospect',l:'qualificação'},
   {f:'prospect',t:'pend',l:'cadastro / ganho'},
   {f:'novo',t:'pend',l:'RF-ACC-3'},
   {f:'pend',t:'cli',l:'aprovado + parceiro'},
   {f:'pend',t:'rej',l:'rejeitado',k:'bad'},
   {f:'mir',t:'cli',l:'RF-ACC-1'},
   {f:'cli',t:'ina',l:'Sankhya'},
   {f:'ina',t:'cli',l:'reativação?',b:-34,k:'pend'}
  ],
  tx:[
   ['lead → prospect','Qualificação do lead (Fase 2)','P'],
   ['prospect → cliente_pendente','Cadastro de cliente ou ganho de oportunidade (RF-OPP-5)','D'],
   ['(novo) → cliente_pendente','Cadastro direto pelo vendedor ou representante, inclusive offline','A'],
   ['cliente_pendente → cliente','Aprovação do backoffice + criação do parceiro pela outbox','A'],
   ['cliente_pendente → rejeitado','Rejeição com motivo e notificação','A'],
   ['(espelho) → cliente','Parceiro existente no Sankhya','A'],
   ['cliente → inativo','Reflete o Sankhya','A'],
   ['inativo → cliente · rejeitado → novo cadastro','Não especificados','U']
  ]},
 {id:'SM-2', a:'sm-pedido', t:'Pedido', st:[['D','RF-ORD-4'],['A','P-09 revisao_preco'],['S','S3 · R24 · R25'],['U','R07']], sec:'s15', cols:6, rows:4,
  nodes:[
   {id:'ras',l:'rascunho',c:0,r:1,k:'initial'},
   {id:'agu',l:'aguardando_aprovacao',c:1,r:0},
   {id:'rep',l:'reprovado',c:2,r:0,k:'bad'},
   {id:'apr',l:'aprovado',c:2,r:1},
   {id:'fila',l:'na_fila',c:3,r:1,sub:'outbox criada'},
   {id:'env',l:'enviado',c:4,r:1,sub:'número Sankhya'},
   {id:'fat',l:'faturado',c:5,r:1,k:'final'},
   {id:'conf',l:'confirmado?',c:5,r:0,k:'pend',sub:'S3 · R24'},
   {id:'parc',l:'faturado_parcial?',c:5,r:2,k:'pend',sub:'S3 · R25'},
   {id:'rev',l:'revisao_preco',c:1,r:2,sub:'P-09'},
   {id:'err',l:'erro_integracao',c:3,r:2,k:'bad'},
   {id:'any',l:'qualquer não enviado',c:1,r:3,k:'note'},
   {id:'can',l:'cancelado',c:4,r:3,k:'bad'}
  ],
  edges:[
   {f:'ras',t:'agu',l:'acima da alçada / crédito'},
   {f:'ras',t:'apr',l:'dentro da alçada',k:'dash'},
   {f:'agu',t:'apr',l:'aprovado'},
   {f:'agu',t:'rep',l:'reprovado',k:'bad'},
   {f:'rep',t:'ras',l:'edição (R07)',b:-30,k:'pend'},
   {f:'apr',t:'fila',l:'outbox'},
   {f:'fila',t:'env',l:'incluído'},
   {f:'fila',t:'err',l:'falha',k:'bad',b:16},
   {f:'err',t:'fila',l:'reprocessar',b:16},
   {f:'env',t:'fat',l:'faturado'},
   {f:'env',t:'conf',l:'S3',k:'pend'},
   {f:'env',t:'parc',l:'S3',k:'pend'},
   {f:'ras',t:'rev',l:'preço mudou',b:14},
   {f:'apr',t:'rev',l:'preço mudou'},
   {f:'rev',t:'ras',l:'confirma / edita',b:14},
   {f:'any',t:'can',l:'cancelar'},
   {f:'env',t:'can',l:'reflete Sankhya',k:'dash'}
  ],
  tx:[
   ['rascunho → aguardando_aprovacao','Desconto acima do limite do vendedor ou exceção de crédito (RF-ORD-3/5)','D'],
   ['rascunho → aprovado','Dentro da alçada: implícito em RF-ORD-5; o diagrama da spec é linear','U'],
   ['aguardando_aprovacao → aprovado / reprovado','Aprovador com alçada decide com comentário','A'],
   ['reprovado → rascunho','Edição permitida (recomendação R07)','U'],
   ['aprovado → na_fila','integration_outbox + job na mesma transação','A'],
   ['na_fila → enviado / erro_integracao','Resultado da entrega pelo worker com SNK-4','A'],
   ['erro_integracao → na_fila','Reprocessamento pelo operador','D'],
   ['enviado → faturado','Acompanhado pelo espelho; vínculo pedido → notas em S3','S'],
   ['enviado → confirmado / faturado_parcial','Estados possíveis após o spike S3 (R24, R25)','S'],
   ['rascunho / aprovado → revisao_preco → rascunho','Preço aplicável mudou (offline); vendedor confirma ou edita; alçada reavaliada','A'],
   ['qualquer não enviado → cancelado · enviado → cancelado','Cancelamento; após envio reflete o Sankhya (S3.4)','D']
  ]},
 {id:'SM-3', a:'sm-oportunidade', t:'Oportunidade', st:[['D','RF-OPP-2'],['P','D9'],['U','BP-04']], sec:'s23', cols:4, rows:3,
  nodes:[
   {id:'ab',l:'aberta',c:0,r:1,k:'initial',sub:'percorre etapas do funil'},
   {id:'gan',l:'ganha',c:1,r:0,k:'final'},
   {id:'per',l:'perdida',c:1,r:2,k:'bad',sub:'motivo obrigatório'},
   {id:'cp',l:'conta cliente_pendente',c:2,r:0,k:'prop',sub:'se não é cliente'},
   {id:'ped',l:'pedido (rascunho)',c:3,r:0,k:'prop',sub:'proposta aceita'}
  ],
  edges:[
   {f:'ab',t:'gan',l:'ganho'},
   {f:'ab',t:'per',l:'perda + motivo',k:'bad'},
   {f:'gan',t:'cp',l:'RF-OPP-5',k:'dash'},
   {f:'gan',t:'ped',l:'RF-PRP-6',b:-90,k:'dash'},
   {f:'per',t:'ab',l:'reabrir?',b:-50,k:'pend',ox:-30}
  ],
  tx:[
   ['aberta (etapas)','Move entre etapas; histórico com tempo por etapa; alerta de parada','D'],
   ['aberta → ganha','Ganho; inicia cadastro de cliente ou oferece gerar pedido','D'],
   ['aberta → perdida','Motivo obrigatório + comentário opcional','D'],
   ['perdida / ganha → aberta','Reabertura não especificada','U']
  ]},
 {id:'SM-4', a:'sm-proposta', t:'Proposta', st:[['D','RF-PRP-3 · RF-PRP-6 · RF-PRP-7'],['P','D10'],['U','BP-15']], sec:'s24', cols:5, rows:3,
  nodes:[
   {id:'ras',l:'rascunho',c:0,r:1,k:'initial',sub:'versão N'},
   {id:'agu',l:'aguardando_aprovacao',c:1,r:0},
   {id:'env',l:'enviada',c:2,r:1},
   {id:'ace',l:'aceita',c:3,r:0,k:'final'},
   {id:'rec',l:'recusada',c:3,r:1,k:'bad'},
   {id:'exp',l:'expirada',c:3,r:2,k:'bad'},
   {id:'ped',l:'pedido',c:4,r:0,k:'prop',sub:'revisão de preço se preciso'}
  ],
  edges:[
   {f:'ras',t:'agu',l:'acima da alçada',ox:26,oy:6},
   {f:'ras',t:'env',l:'envio'},
   {f:'agu',t:'env',l:'aprovada'},
   {f:'agu',t:'ras',l:'reprovada?',b:-60,k:'pend',ox:-40,oy:-10},
   {f:'env',t:'ace',l:'aceite'},
   {f:'env',t:'rec',l:'recusa',k:'bad'},
   {f:'env',t:'exp',l:'validade',k:'bad'},
   {f:'env',t:'ras',l:'editar → versão N+1',b:40,k:'dash'},
   {f:'ace',t:'ped',l:'1 clique'}
  ],
  tx:[
   ['rascunho → aguardando_aprovacao','Desconto acima da alçada (mesmas regras de pedido)','D'],
   ['aguardando_aprovacao → enviada','Aprovada e enviada por e-mail ou link WhatsApp','D'],
   ['aguardando_aprovacao → ?','Reprovação sem status definido em RF-PRP-6','U'],
   ['enviada → aceita / recusada','Resposta do cliente registrada','D'],
   ['enviada → expirada','Automático ao passar da validade, com notificação','D'],
   ['enviada → rascunho (N+1)','Editar proposta enviada cria nova versão; anteriores consultáveis','D'],
   ['aceita → pedido','Um clique gera o pedido; revisão de preço se validade venceu ou preço mudou','D']
  ]},
 {id:'SM-5', a:'sm-importacao', t:'Importação', st:[['D','RF-IMP-1 · RF-IMP-2'],['U','BP-12 — nomes dos estados']], sec:'s38', cols:6, rows:3,
  nodes:[
   {id:'up',l:'arquivo_enviado',c:0,r:1,k:'initial',sub:'.xlsx/.csv'},
   {id:'inv',l:'arquivo_recusado',c:0,r:2,k:'bad',sub:'tipo ou tamanho'},
   {id:'map',l:'mapeamento',c:1,r:1,k:'prop'},
   {id:'val',l:'pre_visualizacao',c:2,r:1,k:'prop',sub:'erros por linha'},
   {id:'canc',l:'cancelada',c:2,r:2,k:'bad'},
   {id:'conf',l:'confirmada',c:3,r:1,k:'prop'},
   {id:'proc',l:'processando',c:4,r:1,k:'prop',sub:'worker'},
   {id:'ok',l:'concluida',c:5,r:0,k:'final'},
   {id:'okerr',l:'concluida_com_erros',c:5,r:1,k:'pend',sub:'planilha de erros'},
   {id:'fal',l:'falhou',c:5,r:2,k:'bad'}
  ],
  edges:[
   {f:'up',t:'inv',l:'> 20 MB / 50 mil',k:'bad'},
   {f:'up',t:'map',l:'válido'},
   {f:'map',t:'val',l:'validar'},
   {f:'val',t:'map',l:'corrigir',b:-26},
   {f:'val',t:'canc',l:'cancelar',k:'bad'},
   {f:'val',t:'conf',l:'confirmar'},
   {f:'conf',t:'proc',l:'job'},
   {f:'proc',t:'ok',l:'sem erros',oy:-14},
   {f:'proc',t:'okerr',l:'linhas com erro'},
   {f:'proc',t:'fal',l:'falha',k:'bad'}
  ],
  tx:[
   ['arquivo_enviado → arquivo_recusado','Tipo ou tamanho inválido, verificado antes do parse','D'],
   ['arquivo_enviado → mapeamento → pre_visualizacao','Sugestão por nome (IA na F3, usuário confirma); erros por linha e duplicados','D'],
   ['pre_visualizacao → confirmada → processando','Confirmação do usuário; processamento em segundo plano','D'],
   ['processando → concluida / concluida_com_erros / falhou','Relatório final com planilha de erros para download; auditoria','D'],
   ['Nomes dos estados','Criados neste blueprint; a spec descreve apenas etapas','U']
  ]},
 {id:'SM-6', a:'sm-comando', t:'Comando de sincronização', st:[['A','P-08 idempotência'],['P','resultados §6.3'],['U','R06 · BP-13']], sec:'s29', cols:5, rows:3,
  nodes:[
   {id:'pen',l:'pendente',c:0,r:1,k:'initial',sub:'outbox local'},
   {id:'wipe',l:'descartado',c:0,r:2,k:'bad',sub:'revogação / wipe'},
   {id:'env',l:'enviando',c:2,r:1,k:'prop'},
   {id:'replay',l:'replay do command_id',c:1,r:0,k:'note',sub:'mesmo resultado'},
   {id:'acc',l:'accepted',c:3,r:0,k:'final'},
   {id:'rev',l:'needs_review',c:4,r:1,k:'pend',sub:'ex.: revisao_preco'},
   {id:'rej',l:'rejected',c:3,r:2,k:'bad',sub:'motivo legível'},
   {id:'blk',l:'bloqueado?',c:4,r:2,k:'pend',sub:'pai rejeitado — R06'}
  ],
  edges:[
   {f:'pen',t:'env',l:'push'},
   {f:'env',t:'pen',l:'rede caiu',b:44},
   {f:'env',t:'acc',l:'accepted'},
   {f:'env',t:'rev',l:'needs_review'},
   {f:'env',t:'rej',l:'rejected',k:'bad'},
   {f:'replay',t:'acc',l:'sem efeito',k:'dash'},
   {f:'rej',t:'blk',l:'dependentes',k:'pend'},
   {f:'pen',t:'wipe',l:'revogado',k:'bad'},
   {f:'rev',t:'pen',l:'usuário age → novo comando',b:-120,k:'dash'}
  ],
  tx:[
   ['pendente → enviando','Push em lote quando há conexão, em ordem de criação','P'],
   ['enviando → pendente','Falha de rede; reenvio com o mesmo command_id','A'],
   ['enviando → accepted / needs_review / rejected','Servidor revalida tudo e armazena o resultado por command_id','A'],
   ['replay → mesmo resultado','Reenvio do mesmo command_id devolve o resultado original sem efeito','A'],
   ['rejected → dependentes bloqueados','Comandos que dependem do pai rejeitado','U'],
   ['pendente → descartado','Aparelho revogado apaga o banco local','D'],
   ['Nomes locais dos estados','Criados neste blueprint','U']
  ]},
 {id:'SM-7', a:'sm-outbox', t:'integration_outbox', st:[['A','STACK-6 · SNK-4'],['D','RF-SNK-3 · RF-SNK-5'],['U','BP-11 — estados']], sec:'s33', cols:5, rows:4,
  nodes:[
   {id:'pen',l:'pendente',c:0,r:1,k:'initial',sub:'mesma transação'},
   {id:'proc',l:'processando',c:1,r:1,k:'prop'},
   {id:'chk',l:'verificando_origem',c:2,r:1,k:'prop',sub:'SNK-4'},
   {id:'exist',l:'vinculado_existente',c:3,r:0,k:'final',sub:'já existia'},
   {id:'send',l:'enviando',c:3,r:1,k:'prop'},
   {id:'ok',l:'entregue',c:4,r:0,k:'final'},
   {id:'retry',l:'aguardando_retry',c:2,r:2,k:'pend',sub:'backoff'},
   {id:'err',l:'erro',c:4,r:2,k:'bad',sub:'permanente / esgotado'},
   {id:'canc',l:'cancelado?',c:0,r:2,k:'pend',sub:'não especificado'}
  ],
  edges:[
   {f:'pen',t:'proc',l:'job pg-boss'},
   {f:'proc',t:'chk',l:'carrega'},
   {f:'chk',t:'exist',l:'origem encontrada'},
   {f:'chk',t:'send',l:'não existe'},
   {f:'send',t:'ok',l:'sucesso'},
   {f:'send',t:'retry',l:'temporário',k:'pend'},
   {f:'send',t:'err',l:'permanente',k:'bad'},
   {f:'retry',t:'proc',l:'backoff expira'},
   {f:'retry',t:'err',l:'8 tentativas',k:'bad'},
   {f:'err',t:'pen',l:'reprocessar (auditado)',b:-190,k:'dash'},
   {f:'pen',t:'canc',l:'?',k:'pend'}
  ],
  tx:[
   ['pendente → processando','Job pg-boss criado na mesma transação do negócio; varredura recria jobs perdidos (proposto)','A'],
   ['processando → verificando_origem','Antes de toda inclusão ou reenvio, consulta o campo de origem com o UUID da entidade','A'],
   ['verificando_origem → vinculado_existente','Registro já existe: não reenvia, vincula','A'],
   ['enviando → entregue','Inclusão confirmada; identificadores de resultado gravados','A'],
   ['enviando → aguardando_retry → processando','Temporário ou rate limit; backoff exponencial até 8 tentativas','D'],
   ['enviando / aguardando_retry → erro','Validação, rejeição permanente ou tentativas esgotadas; visível ao vendedor e ao admin','D'],
   ['erro → pendente','Reprocessamento pelo operador (auditado)','D'],
   ['pendente → cancelado','Entidade cancelada antes da entrega: não especificado','U'],
   ['Nomes dos estados','Criados neste blueprint; campos definidos com o modelo de dados','U']
  ]}
];

/* ----------------------------------------------------------- DECISÕES EM ABERTO
   {id, cat, st, t: tema, rec: recomendação/proposta atual, blk: necessário antes de, sec} */
