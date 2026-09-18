window.MODULES = [
  {c:'IAM', n:'Identidade e acesso', ph:'F0–F1', d:'Login, senha, bloqueio, usuários, equipes, perfis, aparelhos, auditoria', st:[['A','P-11'],['P','AUTH-1…4']]},
  {c:'SNK', n:'Integração Sankhya', ph:'F0–F1', d:'Espelho incremental, reconciliação, outbox, idempotência, saúde, gateway', st:[['A','P-03 · SNK-4 · STACK-6'],['S','S0–S6']]},
  {c:'CAT', n:'Catálogo e preços', ph:'F1', d:'Produtos, preço aplicável, limites de desconto, restrição de custo/margem', st:[['A','P-09 · P-10 · P-20'],['S','S2']]},
  {c:'ACC', n:'Contas', ph:'F1–F2', d:'Carteira, ficha, cliente novo, aprovação, deduplicação, leads, campos e tags', st:[['A','P-18 · P-19'],['U','R17']]},
  {c:'CON', n:'Contatos', ph:'F1–F2', d:'Pessoas da conta, espelho Sankhya, ações rápidas', st:[['D','RF rascunho']]},
  {c:'ORD', n:'Pedidos', ph:'F1', d:'Orçamento/pedido online e offline, bloqueios, estados, aprovação, revisão de preço, planilha, PDF', st:[['A','P-05 · P-08 · P-09'],['U','R07 · R30']]},
  {c:'OPP', n:'Funis e oportunidades', ph:'F2', d:'Funis configuráveis, kanban, perda, ganho, histórico', st:[['P','D9']]},
  {c:'PRP', n:'Propostas', ph:'F2', d:'Itens do catálogo, versões, PDF, envio, aceite → pedido, expiração', st:[['P','D10'],['U','R34']]},
  {c:'ACT', n:'Tarefas e interações', ph:'F1–F2', d:'Tarefas offline, lembretes, follow-ups, timeline, agenda, Calendar', st:[['U','R05']]},
  {c:'AUT', n:'Automações', ph:'F2–F3', d:'Follow-up automático, distribuição de leads, alertas, construtor, log, laços', st:[['A','P-14']]},
  {c:'GOL', n:'Metas e comissões', ph:'F1', d:'Metas, positivação e comissões lidas do Sankhya', st:[['A','P-13'],['S','S6']]},
  {c:'IMP', n:'Importação de planilhas', ph:'F1–F2', d:'Assistente, tipos, limites, PJ importa mas não exporta', st:[['A','P-20'],['U','R14']]},
  {c:'DSH', n:'Dashboards e relatórios', ph:'F1–F2', d:'Vendas, funil, atividades, risco, painel do app, exportações', st:[['A','P-21'],['U','R42']]},
  {c:'NOT', n:'Notificações', ph:'F1–F2', d:'Central, push, eventos mínimos, preferências', st:[['P','OPS-5']]},
  {c:'INT', n:'Integrações externas', ph:'F1–F3', d:'CNPJ, CEP, Google Workspace, WhatsApp link, formulários, anúncios, telefonia', st:[['P','D13']]},
  {c:'IA', n:'IA', ph:'F3', d:'Assistente, resumo, mix, churn, mapeamento de planilhas', st:[['A','P-14'],['U','R18']]}
];

