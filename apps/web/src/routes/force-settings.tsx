import { Alert, Button, Card, CardBody, FormField, Input, PageHeader, Select, SkeletonLines, toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { QueryError } from "../components/query-error";
import { updateForceSettings } from "../lib/api-mutations";
import { customerPriceTablesQueryOptions, forceSettingsQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";

/** Days field: whole number from 1 to 60, as the contract requires; null when invalid. */
export function parseMaxDays(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 60 ? value : null;
}

export function ForceSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const api = useApi();
  const query = useQuery(forceSettingsQueryOptions(api));
  const tables = useQuery(customerPriceTablesQueryOptions(api));

  if (query.isPending) {
    return (
      <>
        {embedded ? null : <PageHeader title="Parâmetros" />}
        <div aria-busy="true">
          <SkeletonLines lines={4} label="Carregando parâmetros…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {embedded ? null : <PageHeader title="Parâmetros" />}
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os parâmetros" />
        </Card>
      </>
    );
  }
  return <SettingsForm embedded={embedded} key={query.data.updatedAt} data={query.data} tables={tables.data?.items ?? []} tablesLoading={tables.isPending} />;
}

function SettingsForm({ data, tables, tablesLoading, embedded }: { embedded: boolean; data: { maxDaysWithoutSync: number; defaultPriceTableCode: number }; tables: { code: number; name: string }[]; tablesLoading: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(String(data.maxDaysWithoutSync));
  const [tableCode, setTableCode] = useState(String(data.defaultPriceTableCode));
  const [showProblems, setShowProblems] = useState(false);
  const parsedDays = parseMaxDays(days);

  const save = useMutation({
    mutationFn: (body: { maxDaysWithoutSync: number; defaultPriceTableCode: number }) => updateForceSettings(api, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.forceSettings, saved);
      toast({ title: "Parâmetros salvos", tone: "success" });
    },
  });
  const failure = save.isError ? describeApiError(save.error, "Não foi possível salvar os parâmetros") : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (parsedDays === null || save.isPending) return;
    save.mutate({ maxDaysWithoutSync: parsedDays, defaultPriceTableCode: Number(tableCode) });
  };

  const known = tables.some((table) => String(table.code) === tableCode);

  return (
    <>
      {embedded ? null : <PageHeader title="Parâmetros" />}
      <div className="flex max-w-2xl flex-col gap-3">
        <Card>
          <CardBody>
            <form onSubmit={submit} noValidate aria-label="Parâmetros" className="flex flex-col gap-3">
              {failure ? (
                <Alert tone="danger" title={failure.title}>
                  {failure.description}
                </Alert>
              ) : null}
              <FormField label="Dias máximos sem sincronizar" required error={showProblems && parsedDays === null ? "Informe de 1 a 60." : undefined}>
                <Input size="md" inputMode="numeric" autoComplete="off" value={days} onChange={(event) => setDays(event.target.value)} />
              </FormField>
              <FormField label="Tabela de preço padrão do cliente novo" required>
                <Select size="md" value={tableCode} disabled={tablesLoading} onChange={(event) => setTableCode(event.target.value)}>
                  {known ? null : <option value={tableCode}>{`Tabela ${tableCode}`}</option>}
                  {tables.map((table) => (
                    <option key={table.code} value={table.code}>
                      {table.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div>
                <Button type="submit" variant="primary" loading={save.isPending}>
                  Salvar
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
