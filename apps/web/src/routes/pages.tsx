import { Button } from "@salesforce/ui";
import { Link, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ComingSoon } from "../components/coming-soon";

/* Route pages. Placeholders until the API contracts exist; each one already carries its final header. */

export function DashboardPage() {
  return <ComingSoon title="Início" description="Resumo da sua carteira e dos pedidos recentes." screen="W-05" />;
}

export function CustomersPage() {
  return <ComingSoon title="Carteira de clientes" description="Busque, filtre e abra os clientes da sua carteira." screen="W-07" />;
}

export function CustomerDetailPage() {
  const { code } = useParams({ strict: false });
  return <ComingSoon title={`Cliente ${code ?? ""}`.trim()} description="Dados cadastrais, condições comerciais e pedidos do cliente." screen="W-08" />;
}

export function ProductsPage() {
  return <ComingSoon title="Catálogo de produtos" description="Consulte produtos, grupos e preços de tabela." screen="W-14" />;
}

export function OrdersPage() {
  return (
    <ComingSoon
      title="Pedidos"
      description="Rascunhos e pedidos do sistema."
      screen="W-16"
      actions={
        <Button asChild variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />}>
          <Link to="/pedidos/novo">Novo pedido</Link>
        </Button>
      }
    />
  );
}

export function NewOrderPage() {
  return <ComingSoon title="Novo pedido" description="Escolha o cliente e monte o pedido." screen="W-17, W-18" />;
}

export function OrderDetailPage() {
  return <ComingSoon title="Pedido" description="Itens, totais estimados e situação do pedido." screen="W-18, W-22" />;
}

export function IntegrationPage() {
  return <ComingSoon title="Integração e configuração" description="Estado da integração com o ERP e da configuração da instalação." screen="W-31, W-38" />;
}
