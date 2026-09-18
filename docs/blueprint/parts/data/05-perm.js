window.PERM = [
 {cap:'Acessar a aplicação web', st:'P', v:{ADM:'y',DIR:'y',GER:'y',VI:'y',PJ:'x',CF:'y'}, cs:{PJ:'P'}, nt:'Representante bloqueado na web no servidor (AUTH-3, proposto).'},
 {cap:'Usar o app mobile', st:'P', v:{ADM:'y',DIR:'y',GER:'y',VI:'y',PJ:'y',CF:'y'}, nt:'Internos: aparelho autoaprovado; PJ: aparelho aprovado por admin/gerente (AUTH-2).'},
 {cap:'Ver clientes, títulos e histórico', st:'P', v:{ADM:'y',DIR:'y',GER:'y',VI:'y',PJ:'y',CF:'y'}, nt:'Sempre limitado pelo escopo (seção 12).'},
 {cap:'Criar pedido / orçamento', st:'P', v:{ADM:'y',DIR:'n',GER:'y',VI:'y',PJ:'y',CF:'n'}},
 {cap:'Aprovar desconto', st:'P', v:{ADM:'y',DIR:'acima do gerente',GER:'até seu limite',VI:'n',PJ:'n',CF:'n'}, cs:{DIR:'A',GER:'A'}, nt:'Escada de alçada aprovada (P-10); base e roteamento pendentes (R35, R36).'},
 {cap:'Aprovar exceção de crédito', st:'U', v:{ADM:'?',DIR:'?',GER:'?',VI:'n',PJ:'n',CF:'proposto'}, nt:'A matriz da spec não tem esta permissão; recomendação: Cadastro/Financeiro (R37).'},
 {cap:'Cadastrar cliente novo', st:'P', v:{ADM:'y',DIR:'n',GER:'y',VI:'y',PJ:'y',CF:'y'}},
 {cap:'Aprovar cliente novo', st:'P', v:{ADM:'y',DIR:'n',GER:'n',VI:'n',PJ:'n',CF:'y'}, cs:{CF:'A'}, nt:'Aprovação pelo backoffice antes de virar parceiro (P-18).'},
 {cap:'Funis e oportunidades (F2)', st:'P', v:{ADM:'configurar',DIR:'ver',GER:'y',VI:'y',PJ:'y',CF:'n'}, cs:{PJ:'U'}, nt:'PJ sem web e sem telas mobile de CRM especificadas (BP-10).'},
 {cap:'Propostas (F2)', st:'P', v:{ADM:'y',DIR:'ver',GER:'y',VI:'y',PJ:'y',CF:'n'}, cs:{PJ:'U'}},
 {cap:'Tarefas', st:'P', v:{ADM:'y',DIR:'ver',GER:'equipe',VI:'y',PJ:'y',CF:'próprias'}},
 {cap:'Configurar automações (F2)', st:'P', v:{ADM:'y',DIR:'n',GER:'equipe',VI:'n',PJ:'n',CF:'n'}},
 {cap:'Importar planilhas', st:'P', v:{ADM:'y',DIR:'n',GER:'y',VI:'pedido, clientes, leads',PJ:'pedido, clientes',CF:'clientes'}, cs:{PJ:'U'}, nt:'UX do PJ sem web: R14.'},
 {cap:'Exportar dados e relatórios', st:'P', v:{ADM:'y',DIR:'y',GER:'y',VI:'y',PJ:'x',CF:'y'}, cs:{PJ:'A'}, nt:'PJ nunca recebe capacidade geral de exportação (P-20). Toda exportação auditada.'},
 {cap:'Ver custo e margem (web)', st:'P', v:{ADM:'y',DIR:'y',GER:'configurável',VI:'n',PJ:'x',CF:'n'}, cs:{PJ:'A'}, nt:'Nunca enviado ao PJ em canal algum (P-20).'},
 {cap:'Ver custo e margem (mobile)', st:'P', v:{ADM:'x',DIR:'x',GER:'x',VI:'x',PJ:'x',CF:'x'}, cs:{PJ:'A'}, nt:'Nunca no mobile para nenhum usuário (P-23, proposto).'},
 {cap:'Dashboards', st:'P', v:{ADM:'todos',DIR:'todos',GER:'equipe',VI:'próprios',PJ:'próprios (resumo)',CF:'carteira/pendências'}},
 {cap:'Assistente IA (F3)', st:'P', v:{ADM:'y',DIR:'y',GER:'y',VI:'y',PJ:'y',CF:'y'}, nt:'Mesmo escopo do usuário (P-21); base de conhecimento por perfil (R18).'},
 {cap:'Aprovar / revogar aparelho', st:'P', v:{ADM:'y',DIR:'n',GER:'PJ da equipe',VI:'n',PJ:'n',CF:'n'}, nt:'AUTH-2, proposto.'},
 {cap:'Reprocessar integração (fila de erros)', st:'P', v:{ADM:'y',DIR:'n',GER:'n',VI:'n',PJ:'n',CF:'n'}, nt:'Vendedor vê o erro no status do pedido (RF-SNK-5).'},
 {cap:'Configurar limites de desconto', st:'P', v:{ADM:'y',DIR:'?',GER:'n',VI:'n',PJ:'n',CF:'n'}, cs:{DIR:'U'}, nt:'Configurados no Sales Force (P-10); quem além do admin: BP-17.'},
 {cap:'Consultar auditoria', st:'P', v:{ADM:'y',DIR:'?',GER:'?',VI:'n',PJ:'n',CF:'?'}, cs:{DIR:'U',GER:'U',CF:'U'}, nt:'Não especificado (BP-06).'},
 {cap:'Usuários, integrações, configurações', st:'P', v:{ADM:'y',DIR:'n',GER:'n',VI:'n',PJ:'n',CF:'n'}}
];

/* Escopo de dados por recurso. v: nenhum/proprio/equipe/tudo/?; texto após | é nota. */
