
/* ===================== WEB ===================== */
{ id: 'W-01', name: 'Login', grp: 'web', plat: 'Web', ph: 'F0', prof: WALL, mock: 'mk-login',
  purpose: 'Autenticar usuários internos na web com e-mail e senha.',
  info: 'Formulário de acesso · aviso de bloqueio temporário · link Esqueci minha senha',
  fields: 'E-mail · Senha', filters: '—', cols: '—',
  actions: 'Entrar · Esqueci minha senha',
  perms: 'Público (não autenticado) · perfil Representante PJ recusado no servidor no login e em toda requisição → W-04 (AUTH-3 PROPOSTO)',
  rules: '5 falhas → bloqueio de 15 min; bloqueios repetidos → desbloqueio pelo admin (RF-IAM-2) · PROPOSTO: resposta não revela se o e-mail existe · PROPOSTO AUTH-1: cookie httpOnly/Secure/SameSite=Lax + CSRF; expira após 12 h de inatividade',
  error: 'Credenciais inválidas (mensagem genérica) · conta bloqueada com orientação · limite de requisições atingido',
  denied: 'Perfil sem canal web → W-04, nenhuma sessão criada',
  audit: 'login bem-sucedido · falha de login · bloqueio',
  ents: 'users · sessions · audit_log', rf: 'RF-IAM-1 · RF-IAM-2 · RF-IAM-9',
  st: [INV, P11, AUTH1, AUTH3, ['U', 'Nº de bloqueios que exige desbloqueio pelo admin (revisão de segurança F0)']] },
