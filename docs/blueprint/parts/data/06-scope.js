window.SCOPE = [
 {res:'Contas e clientes', v:{ADM:'tudo',DIR:'tudo',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'tudo|só contas e pendências'}},
 {res:'Contatos, títulos, histórico', v:{ADM:'tudo',DIR:'tudo',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'tudo'}, nt:'Herdam a visibilidade da conta.'},
 {res:'Pedidos', v:{ADM:'tudo',DIR:'tudo',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'?|exceção de crédito R37'}},
 {res:'Oportunidades e propostas', v:{ADM:'tudo',DIR:'tudo|ver',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'nenhum|sem acesso ao funil'}},
 {res:'Tarefas', v:{ADM:'tudo',DIR:'tudo|ver',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'proprio'}},
 {res:'Leads sem responsável', v:{ADM:'tudo',DIR:'?',GER:'equipe|pool proposto',VI:'nenhum',PJ:'nenhum',CF:'nenhum'}, nt:'R53.'},
 {res:'Metas e comissões', v:{ADM:'tudo',DIR:'tudo',GER:'equipe',VI:'proprio',PJ:'proprio',CF:'?'}, nt:'RF-GOL-3: vendedor as próprias, gerente as da equipe.'},
 {res:'Dashboards', v:{ADM:'tudo',DIR:'tudo',GER:'equipe',VI:'proprio',PJ:'proprio|resumo',CF:'tudo|carteira e pendências'}},
 {res:'Auditoria', v:{ADM:'tudo',DIR:'?',GER:'?',VI:'nenhum',PJ:'nenhum',CF:'?'}, nt:'BP-06.'}
];

/* ------------------------------------------------------------------ FLUXOS
   lanes: [código, rótulo]; steps: {l: lane, k: s|n|d|e|x|w, t: texto, o: saídas, s: [[status, rótulo]]} */
