import { ForbiddenState, LoadingPanel, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { ForceSettingsPage } from "./force-settings";
import { MetasPage } from "./metas";
import { SellerDiscountRulesPage } from "./seller-discount-rules";

export const PARAMETER_TABS = ["metas", "descontos", "geral"] as const;
export type ParameterTab = (typeof PARAMETER_TABS)[number];

/** `?aba=` of the route; anything else is dropped (the first tab opens). */
export function parseParametersSearch(search: Record<string, unknown>): { aba?: ParameterTab } {
  // An old ?aba=codigo opens Geral.
  if (search.aba === "codigo") return { aba: "geral" };
  const aba = PARAMETER_TABS.find((tab) => tab === search.aba);
  return aba ? { aba } : {};
}

/** Who may open the parameters (the server enforces each call): manager and administrator. */
export const canOpenParameters = (role: string | undefined): boolean => role === "admin" || role === "manager";

/** A tab of future configuration is one more entry here. */
export function parameterTabsFor(role: string | undefined): { value: ParameterTab; label: string }[] {
  if (!canOpenParameters(role)) return [];
  const tabs: { value: ParameterTab; label: string }[] = [
    { value: "metas", label: "Metas" },
    { value: "descontos", label: "Descontos" },
    { value: "geral", label: "Geral" },
  ];
  return tabs;
}

export function ParametersPage() {
  const { authClient } = useAppServices();
  const session = useQuery(sessionQueryOptions(authClient));
  const search = useSearch({ strict: false }) as { aba?: ParameterTab };
  const navigate = useNavigate();

  if (session.isPending) return <LoadingPanel title="Carregando…" lines={3} />;
  const tabs = parameterTabsFor(session.data?.role);
  if (tabs.length === 0) return <ForbiddenState title="Acesso negado" />;

  const current = tabs.find((tab) => tab.value === search.aba)?.value ?? "metas";
  return (
    <>
      <PageHeader title="Parâmetros" />
      <Tabs value={current} onValueChange={(value) => void navigate({ to: "/parametros", search: { aba: value as ParameterTab }, replace: true })}>
        <TabsList aria-label="Parâmetros">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="metas">
          <MetasPage embedded />
        </TabsContent>
        <TabsContent value="descontos">
          <SellerDiscountRulesPage embedded />
        </TabsContent>
        <TabsContent value="geral">
          <ForceSettingsPage embedded />
        </TabsContent>
      </Tabs>
    </>
  );
}
