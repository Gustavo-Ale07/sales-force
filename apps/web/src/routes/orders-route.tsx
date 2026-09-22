import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { NotFound } from "../components/route-states";
import { TemplateSkippedNotice } from "../components/template-skipped-notice";
import { parseOrdersSearch } from "../lib/route-search";
import { asInt } from "../lib/search-params";
import { OrderEditorPage } from "./order-editor";
import { OrdersPage } from "./orders";

/** Route components of the orders area: one lazy chunk (see router.tsx). */
export function OrdersRoute() {
  const navigate = useNavigate();
  const params = parseOrdersSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return (
    <OrdersPage
      params={params}
      onSearchChange={(next) => void navigate({ to: "/pedidos", search: next, replace: true })}
      onOpenOrder={(id) => void navigate({ to: "/pedidos/$id", params: { id } })}
    />
  );
}

export function NewOrderRoute() {
  const navigate = useNavigate();
  const { customer } = useSearch({ strict: false }) as { customer?: unknown };
  return (
    <OrderEditorPage
      initialCustomerCode={asInt(customer, 0)}
      onCreated={(id) => void navigate({ to: "/pedidos/$id", params: { id }, replace: true })}
      onClose={() => void navigate({ to: "/pedidos" })}
    />
  );
}

const orderNoticeDescriptions: Record<"template" | "repeat-last", string> = {
  template: "O rascunho foi criado com os demais itens do modelo. Confira as quantidades e adicione o que faltar.",
  "repeat-last":
    "O rascunho foi criado com os demais itens do último pedido registrado no Sales Force. Confira as quantidades e adicione o que faltar.",
};

export function OrderRoute() {
  const navigate = useNavigate();
  const { id } = useParams({ strict: false });
  const orderNotice = useLocation({ select: (location) => location.state.orderNotice });
  const [dismissed, setDismissed] = useState(false);
  if (!id) return <NotFound />;
  const skippedLines = orderNotice?.skippedLines;
  return (
    <OrderEditorPage
      orderId={id}
      onCreated={() => undefined}
      onClose={() => void navigate({ to: "/pedidos" })}
      notice={
        orderNotice && skippedLines && skippedLines.length > 0 && !dismissed ? (
          <TemplateSkippedNotice
            lines={skippedLines}
            description={orderNoticeDescriptions[orderNotice.source]}
            onDismiss={() => setDismissed(true)}
          />
        ) : undefined
      }
    />
  );
}
