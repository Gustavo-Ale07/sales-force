import { Button, Money, formatDocument, titleCase } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { IdCard } from "lucide-react";
import type { ReactNode } from "react";
import { orderEntryConfigurationQueryOptions, customerOrderHabitsQueryOptions, customerQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { CustomerStatus } from "../routes/customers";

export interface CustomerContextBarProps {
  customerCode: number;
  customerName: string;
  onOpenFicha: () => void;
}

function BarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="m-0 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

/**
 * Context of the customer the order is being built for, pinned under the navbar (Vidya "Nova venda"): code and
 * name, document, price table, credit limit when the server sends it, status, and the button that opens the
 * Ficha do Cliente without leaving the order. The monthly credit limit shows only when the server sends it; the most-used
 * negotiation comes from the orders recorded in Sales Force (so it says so) and shows only when there is one. Fields that
 * have no source (fiscal classification, "never bought": the ERP order history is not mirrored) are not shown rather than invented.
 */
export function CustomerContextBar({ customerCode, customerName, onOpenFicha }: CustomerContextBarProps) {
  const api = useApi();
  const query = useQuery({ ...customerQueryOptions(api, customerCode), staleTime: 30_000 });
  const habits = useQuery({ ...customerOrderHabitsQueryOptions(api, customerCode), staleTime: 30_000 });
  const configuration = useQuery({ ...orderEntryConfigurationQueryOptions(api), staleTime: 5 * 60_000 });
  const detail = query.data;
  const usedCode = habits.data?.mostUsedNegotiationTypeCode ?? null;
  const usedLabel =
    usedCode === null ? null : (configuration.data?.sales.negotiationTypes.find((type) => type.code === usedCode)?.label ?? `Negociação ${usedCode}`);
  return (
    <section
      aria-label="Cliente do pedido"
      className="z-20 md:sticky md:top-[var(--sf-topbar-h)] -mx-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-3 shadow-sm md:-mx-8 md:px-8 xl:-mx-12 xl:px-12"
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="m-0 truncate text-sm font-bold text-fg">
          Cliente: {customerCode} – <span className="font-semibold">{titleCase(customerName)}</span>
        </p>
        <p className="m-0 truncate text-xs text-fg-muted">{detail ? `CNPJ/CPF: ${formatDocument(detail.document)}` : "Carregando dados do cliente…"}</p>
      </div>
      {detail ? (
        <dl className="m-0 flex flex-wrap items-center gap-x-6 gap-y-1">
          <BarField label="Tabela de preço">
            {detail.priceTableCode === null ? "Sem tabela" : `${detail.priceTableCode}${detail.priceTableName ? ` – ${detail.priceTableName}` : ""}`}
          </BarField>
          <BarField label="Limite de crédito">
            {detail.creditLimit === null ? <span className="text-fg-faint">Não disponível</span> : <Money value={detail.creditLimit} />}
          </BarField>
          {typeof detail.monthlyCreditLimit === "string" ? (
            <BarField label="Limite mensal">
              <Money value={detail.monthlyCreditLimit} />
            </BarField>
          ) : null}
          {usedLabel !== null && habits.data ? (
            <BarField label="Negociação mais usada (pedidos no Force)">
              <span title={`${habits.data.mostUsedNegotiationOrderCount} de ${habits.data.orderCount} pedidos`}>{usedLabel}</span>
            </BarField>
          ) : null}
          <CustomerStatus active={detail.active} blocked={detail.blocked} />
        </dl>
      ) : null}
      <Button type="button" variant="secondary" size="sm" leftIcon={<IdCard size={14} aria-hidden="true" />} onClick={onOpenFicha} className="shrink-0">
        Ficha do cliente
      </Button>
    </section>
  );
}
