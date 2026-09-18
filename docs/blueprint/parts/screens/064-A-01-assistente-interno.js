
/* ===================== IA ===================== */
{ id: 'A-01', name: 'Assistente interno', grp: 'ia', plat: 'Web + Mobile', ph: 'F3', prof: ['ADM', 'DIR', 'GER', 'VI', 'PJ', 'CF'], mock: 'mk-assistente',
  purpose: 'Responder dúvidas de uso, produtos e políticas e consultar dados em linguagem natural.',
  info: 'Conversa · respostas com referências a registros · base de conhecimento',
  fields: 'Pergunta', filters: '—', cols: '—',
  actions: 'Perguntar · Abrir registro citado · Nova conversa',
  perms: 'Todos os perfis (§8.2); ferramentas chamam a API com as permissões do usuário logado (RF-IA-1, P-21) · PJ usa no app (AUTH-3 PROPOSTO)',
  rules: 'Somente online · chamado só pelo backend; chave nunca no cliente · ferramentas só de leitura na F3 (P-14) · nunca envia senhas, tokens, dados fora do escopo; custo/margem nunca (P-23 PROPOSTO) · teto mensal global e por usuário · verifica stop_reason/recusa',
  offline: 'Indisponível offline; mensagem clara', sync: 'Não sincroniza; requisição online à API',
  error: 'Teto de custo atingido · provedor indisponível · recusa do modelo',
  audit: '—',
  ents: 'ai_requests · ai_budgets · knowledge_documents', rf: 'RF-IA-1',
  st: [INV, P14, P21, P23, ['U', 'R18 — visibilidade da base por perfil'], ['U', 'R67 — LGPD: transferência internacional']] },
