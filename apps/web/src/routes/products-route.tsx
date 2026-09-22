import { useNavigate, useSearch } from "@tanstack/react-router";
import { parseProductsSearch } from "../lib/route-search";
import { ProductsPage } from "./products";

/** Route component of the products screen: a lazy chunk (see router.tsx). */
export function ProductsRoute() {
  const navigate = useNavigate();
  const params = parseProductsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return <ProductsPage params={params} onSearchChange={(next) => void navigate({ to: "/produtos", search: next, replace: true })} />;
}
