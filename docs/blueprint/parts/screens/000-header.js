/* Sales Force — Blueprint Draft v0.1 — Catálogo de telas (documentação, não é código da aplicação).
   Códigos de perfil: ADM Admin · DIR Diretoria · GER Gerente/Supervisor · VI Vendedor interno · PJ Representante PJ · CF Cadastro/Financeiro.
   Status: A APROVADO · P PROPOSTO · V PRECISA VALIDAR · U DECISÃO PENDENTE · R REJEITADO · S SPIKE NECESSÁRIO. */
(function () {
var INV = ['P', 'Inventário e layout da tela (blueprint v0.1)'];
var P02 = ['A', 'P-02 — Sankhya é o sistema de registro do ERP'];
var P07 = ['A', 'P-07 — mobile offline-first'];
var P08 = ['A', 'P-08 — comandos offline idempotentes e revalidados no servidor'];
var P09 = ['A', 'P-09 — revisão de preço; nunca troca silenciosa'];
var P10 = ['A', 'P-10 — alçada vendedor → gerente → diretoria configurada no Sales Force'];
var P11 = ['A', 'P-11 — e-mail + senha forte, Argon2id, sem 2FA'];
var P13 = ['A', 'P-13 — fora de escopo (estoque, GPS, cálculo próprio de metas/comissões…)'];
var P14 = ['A', 'P-14 — IA fora das regras determinísticas; ferramentas só leitura na F3'];
var P15 = ['A', 'P-15 — produção e staging isolados'];
var P17 = ['A', 'P-17 — arquivos em object storage; metadados no PostgreSQL'];
var P18 = ['A', 'P-18 — aprovação do backoffice antes de virar parceiro Sankhya'];
var P19 = ['A', 'P-19 — tabela única de contas (lead → prospect → cliente_pendente → cliente)'];
var P20 = ['A', 'P-20 — PJ nunca recebe custo, margem ou exportação'];
var P21 = ['A', 'P-21 — autorização no servidor (API, sync, dashboards, IA)'];
var P22 = ['A', 'P-22 — segredos nunca expostos a clientes ou documentação'];
var SNK4 = ['A', 'SNK-4 — campo de origem (UUID) verificado antes de reenviar'];
var STACK6 = ['A', 'STACK-6 — integration_outbox é o registro de negócio; pg-boss executa'];
var AUTH1 = ['P', 'AUTH-1 — sessões opacas; tokens guardados só como hash'];
var AUTH2 = ['P', 'AUTH-2 — aprovação de aparelho (pending → approved → revoked)'];
var AUTH3 = ['P', 'AUTH-3 — Representante PJ sem acesso web'];
var AUTH4 = ['P', 'AUTH-4 — escopo por permissão (nenhum/proprio/equipe/tudo) e módulo central'];
var P23 = ['P', 'P-23 — custo/margem nunca no mobile (nenhum usuário) nem para IA'];
var SYNC = ['P', 'SYNC-1…3 — protocolo próprio, watermark xid8, eventos de escopo'];
var MOB2 = ['P', 'MOB-2 — SQLite criptografado (biblioteca por S7 / V-09)'];
var R35 = ['U', 'R35 — base de cálculo da alçada'];
var R36 = ['U', 'R36 — roteamento, teto absoluto e aprovador substituto'];
var WALL = ['ADM', 'DIR', 'GER', 'VI', 'CF'];
var WPJ = ' · PJ sem acesso web (AUTH-3 PROPOSTO)';
window.SCREENS = [