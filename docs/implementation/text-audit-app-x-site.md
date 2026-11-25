# Auditoria de textos e ordem: app x site (PAR-1)

Data: 2026-11-25. Referência: o app (`apps/mobile/src`, `apps/mobile/app`). Site: `apps/web/src`. Coluna "Igual?": sim = idêntico depois desta rodada; ajustado = o site foi alinhado nesta rodada; só site = funcionalidade de gestão ou de navegador que o app não tem, mantida; divergente = ainda difere e está listado em "Divergências não resolvidas".

## Menu

| Tela | App | Site | Igual? |
|---|---|---|---|
| Ordem | Início, Clientes, Vendas, Catálogo, Perfil | Início, Clientes, Vendas, Catálogo, Perfil, depois Aguardando liberação, Aprovações, Limites de desconto, Integração, Configurações | ajustado (itens de gestão só no site) |
| Migalha / título do documento | Vendas, Catálogo, Perfil | Vendas, Catálogo, Perfil (antes: Pedidos, Produtos, Meu perfil) | ajustado |
| Menu do avatar | (sem menu) | Perfil, Sair (antes: Meu perfil, Atualizar dados, "Dados do Sankhya de hh:mm") | ajustado (só site: Sair) |

## Início

| Tela | App | Site | Igual? |
|---|---|---|---|
| Saudação | Olá, {nome} | Olá, {nome} (antes: Bom dia, {primeiro nome}. / Resumo da sua carteira e dos pedidos recentes.) | ajustado |
| Ação principal | Novo pedido | Novo pedido | sim |
| Pedidos recentes, Situação dos pedidos recentes, Total estimado | não existe | removido | ajustado |
| Atenção necessária, Outros indicadores | não existe | removido | ajustado |
| Contadores | Pedidos locais, Pendências de sincronização, Clientes disponíveis, Produtos no aparelho | Clientes, Produtos, Vendáveis, Pedidos em aberto, R$ não enviados | divergente (indicadores do servidor, ver abaixo) |

## Clientes

| Tela | App | Site | Igual? |
|---|---|---|---|
| Título | Clientes | Clientes | sim |
| Busca (rótulo / dica) | Buscar cliente / Buscar por nome, código ou documento | idem (antes: Código, nome ou documento) | ajustado |
| Filtro de tabela | Com tabela de preço, Sem tabela de preço | idem (antes: Com tabela, Sem tabela) | ajustado |
| Índice | A–Z | A–Z | sim |
| Vazio | Nenhum cliente disponível; Nenhum cliente com estes filtros. | idem, sem frase explicativa (antes: Nenhum cliente na carteira / Nenhum cliente encontrado + explicação) | ajustado |
| Legenda da tabela | Clientes | Clientes (antes: Carteira de clientes) | ajustado |
| Detalhe | Dados principais (Código, Documento); Comercial (Vendedor, Tabela de preço); Financeiro (Limite de crédito); Novo pedido | Dados principais (antes: Dados cadastrais); Financeiro (antes: Situação financeira); Tabela de preço; Vendedor preferencial; Novo pedido | ajustado nos títulos; blocos extras (Razão social, Títulos em aberto, Análise, Engajamento) só site |

## Catálogo

| Tela | App | Site | Igual? |
|---|---|---|---|
| Título | Catálogo | Catálogo (antes: Catálogo de produtos) | ajustado |
| Visualização | Visualização: Grade / Lista | Visualização: Grade / Lista (antes: Modo de exibição do catálogo, Fotos, Lista + descrições) | ajustado |
| Busca | Buscar por código ou descrição | idem (antes: Código, descrição ou referência) | ajustado |
| Vazio | Nenhum produto disponível; Nenhum produto com estes filtros. | idem, sem frase explicativa (antes: Catálogo vazio / Nenhum produto encontrado + explicação) | ajustado |
| Seletores de produto (pedido) | Nenhum produto encontrado para “texto”. | Nenhum produto encontrado, sem frase explicativa | ajustado |
| Filtro Venda (Vendáveis / Não vendáveis), origem do preço | não existe | existe | só site |

## Vendas

| Tela | App | Site | Igual? |
|---|---|---|---|
| Título | Vendas (Minhas vendas na lista) | Vendas | sim |
| Abas | Não enviados, Enviados | Não enviados, Enviados | sim |
| Busca | Buscar venda / Buscar por cliente, código ou nº do pedido | idem (antes: Nº do pedido ou cliente / Número ou cliente) | ajustado |
| Total | Total (detalhe); Valor parcial | Total, Valor parcial (antes: Total estimado, (parcial)) | ajustado |
| Vazio | Nenhuma venda pendente.; Nenhuma venda enviada ainda.; Nenhuma venda encontrada com esses filtros. | idem, sem frase explicativa | ajustado |
| Descrição do cabeçalho | não existe | só aparece quando o envio ao Sankhya está desabilitado (antes começava com "Pedidos.") | ajustado |
| Ação | Novo pedido | Novo pedido | sim |

## Detalhe do pedido e editor

| Tela | App | Site | Igual? |
|---|---|---|---|
| Colunas e totais | Itens (n), Total | Total (antes: Total estimado nas tabelas de itens, aprovações e ficha do cliente) | ajustado |
| Ações | Editar pedido, Compartilhar PDF, Duplicar como pedido, Excluir | Editar, Imprimir/PDF, Duplicar, Excluir | divergente (rótulos de ação do editor do site) |
| Editor / assistente | assistente em passos | editor em página única, com vários rótulos próprios (Itens do pedido, Dados do pedido, Subtotal (tabela), IPI estimado...) | divergente (estrutura diferente) |

## Perfil

| Tela | App | Site | Igual? |
|---|---|---|---|
| Título | (aba) Perfil | Perfil (antes: Meu perfil) | ajustado |
| Conta | Minha conta: Nome, Usuário, Perfil | Minha conta: Nome, Usuário, Perfil (antes: Conta, Perfil de acesso) | ajustado |
| Foto | Trocar foto, Remover foto (sem título de bloco) | sem título de bloco (antes: Foto) | ajustado |
| Carteira / Vendedores vinculados | não existe | removido | ajustado |
| Sincronização | Situação, Última sincronização, Sincronizar agora | Situação (antes: Estado), Última sincronização, Sincronizar agora | ajustado |
| Sobre | Aplicativo, Versão, Ambiente | Aplicativo, Versão, Ambiente | sim |

## Diálogos

| Tela | App | Site | Igual? |
|---|---|---|---|
| Atualização de dados | tela cheia; Concluir; Tentar de novo; Fechar | idem; abre só no indicador do cabeçalho e em Sincronizar agora (Perfil) | sim |
| Confirmar exclusão | Excluir pedido?; Este pedido será removido deste aparelho... | Excluir pedido? com texto do servidor | divergente (texto depende do aparelho no app) |

## Divergências não resolvidas

1. Contadores do Início: o site mostra indicadores do servidor (Clientes, Produtos, Vendáveis, Pedidos em aberto, R$ não enviados); o app mostra os contadores do aparelho. "No aparelho" não faz sentido no site. Decisão do dono: igualar a um conjunto comum ou manter.
2. Rótulos de ação e estrutura do editor de pedido (site) x assistente (app): fora do escopo de textos soltos, depende de decisão de desenho.
3. Blocos de gestão e de ficha do cliente (Títulos em aberto, Análise, Engajamento, filtro Venda, origem do preço): funcionalidade só do site, mantida.
4. Mensagens de erro do servidor e dos diálogos de desconto não foram comparadas uma a uma.
