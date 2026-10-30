# Roteiro — auditoria funcional completa do Vidya Force

Você vai fazer uma auditoria funcional COMPLETA do Vidya Force, o sistema de força de vendas que a minha empresa (PLAC, fabricante de forminhas e artigos para festa, ERP Sankhya) usa hoje. Use a aba do Vidya Force que já está aberta e logada. O resultado vai para outro assistente comparar com o sistema que estamos construindo para substituí-lo, então quero fatos observados na tela, não suposições.

## REGRA NÚMERO UM — SOMENTE LEITURA

O Vidya está ligado ao Sankhya de PRODUÇÃO. Nunca clique em Salvar, Enviar, Confirmar, Aprovar, Reprovar, Excluir, Cancelar pedido, Sincronizar, Importar ou qualquer botão que grave, envie ou altere dados ou configurações. Pode abrir formulários, menus, filtros, abas, registros existentes e telas de configuração para LER; ao terminar, feche ou cancele sem salvar. Se aparecer um diálogo de confirmação de alteração, cancele. Não exporte relatórios grandes nem repita consultas pesadas. Não escreva no documento CPF, CNPJ, telefone, e-mail ou endereço de cliente ou vendedor: use só códigos (ex.: "cliente 5778", "vendedor 76").

## MÉTODO

Trabalhe módulo por módulo, na ordem abaixo, e vá acrescentando ao documento ao final de cada módulo (se a sessão cair, o parcial fica).

Para cada tela, registre:
- nome do menu e caminho de navegação;
- para que serve;
- perfis que parecem ter acesso;
- campos e filtros (nome, tipo, obrigatório, valor padrão, se vem do Sankhya ou é editável);
- botões e ações;
- regras e travas (o que bloqueia, a mensagem exata, quando dispara);
- status e transições;
- o que é só leitura.

Quando não conseguir verificar algo, escreva "NÃO VERIFICADO" e o motivo — nunca preencha com o que "normalmente" um sistema faz. Marque cada funcionalidade com um ID sequencial (V-001, V-002, …) para eu cruzar depois.

## ORDEM DOS MÓDULOS

1. **Mapa de navegação**: todos os menus e submenus, com a rota/URL de cada tela.

2. **Clientes**: carteira (lista, busca, filtros, ordenação); ficha do cliente (todas as abas); histórico de compras; financeiro (títulos, vencidos, limite de crédito, bloqueios de venda e as mensagens); contatos; endereços; mapa; cliente novo/prospect e como é aprovado.

3. **Catálogo**: lista e busca de produtos; grupos/hierarquia; imagens; unidades; preço por tabela; promoções; estoque (se aparece); produtos inativos; destaque.

4. **Pedido, ponta a ponta**: novo pedido → cliente → tabela de preço aplicada → tipo de negociação/condição de pagamento → transportadora → itens (quantidade, unidade, desconto por item, desconto geral, limites de desconto e o que acontece ao passar) → observações → salvar × enviar → situações (0 a 6 e o -1), número do pedido no Sankhya, faturamento, nota fiscal → duplicar, repetir último, orçamento × pedido, importação de planilha do cliente (assistente, formatos, erros), impressão/PDF/compartilhar. Abra pedidos existentes em cada situação para ver o que muda na tela. Use "novo pedido" só para ver campos e regras, e DESCARTE sem salvar.

5. **Aprovações**: filas de desconto, crédito e cliente novo — quem aprova, o que o vendedor vê enquanto espera, comentários, histórico.

6. **Metas, positivação, comissões, performance, engajamento, agenda, mural, notificações**: o que existe, o que mostra, de onde vêm os números.

7. **Relatórios e exportações**: lista de todos, filtros, formatos.

8. **Administração**: usuários; perfis e permissões (matriz do que cada perfil pode); vendedores e vínculo com usuário; dispositivos/aparelhos; parâmetros de configuração (liste nome e valor atual de cada parâmetro visível; nunca senhas ou chaves); integração/sincronização com o Sankhya (status, última sync, erros, reprocessar); logs/auditoria.

9. **App mobile**: tudo que a web revelar sobre o app (configurações do app, versão mínima, offline, dispositivos). O app em si não dá para navegar aqui — marque como "verificar no celular".

## ENTREGA

Um único documento Markdown, em português, com esta estrutura:

- **(A)** mapa de navegação;
- **(B)** um capítulo por módulo, com tabelas;
- **(C)** catálogo de travas — toda mensagem de bloqueio ou validação encontrada, com a condição que dispara;
- **(D)** catálogo de funcionalidades V-001… com uma linha cada (módulo, nome, o que faz, perfil, evidência = tela onde viu);
- **(E)** o que o vendedor usa no dia a dia, em ordem de frequência provável, pelo que a navegação sugere;
- **(F)** problemas, inconsistências e lentidões observados;
- **(G)** lista do que ficou NÃO VERIFICADO.

Entregue o documento como arquivo para download, não só como texto na conversa.
