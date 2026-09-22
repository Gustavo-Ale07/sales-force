import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { NotFound } from "../components/route-states";
import { parseCustomersSearch } from "../lib/route-search";
import { asInt } from "../lib/search-params";
import { CustomerDetailPage } from "./customer-detail";
import { CustomersPage } from "./customers";

/** Route components of the customers area: one lazy chunk (see router.tsx). */
export function CustomersRoute() {
  const navigate = useNavigate();
  const params = parseCustomersSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return (
    <CustomersPage
      params={params}
      onSearchChange={(next) => void navigate({ to: "/clientes", search: next, replace: true })}
      onOpenCustomer={(code) => void navigate({ to: "/clientes/$code", params: { code: String(code) } })}
    />
  );
}

export function CustomerDetailRoute() {
  const { code } = useParams({ strict: false });
  const parsed = asInt(code, 0);
  return parsed === undefined ? <NotFound /> : <CustomerDetailPage code={parsed} />;
}
