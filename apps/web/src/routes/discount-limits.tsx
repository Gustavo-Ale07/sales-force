import { Alert, Button, Card, CardBody, CardHeader, FormField, Input, PageHeader, SkeletonLines, toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { QueryError } from "../components/query-error";
import { updateDiscountLimits } from "../lib/api-mutations";
import { discountLimitsQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import { errorCode } from "../lib/http-error";

type LimitsForm = { seller: string; manager: string; director: string };
type LevelKey = keyof LimitsForm;

const FIELDS: { key: LevelKey; label: string; hint: string }[] = [
  { key: "seller", label: "Vendedor", hint: "Maior desconto que o vendedor concede sozinho." },
  { key: "manager", label: "Gerente", hint: "Maior desconto que o gerente aprova." },
  { key: "director", label: "Diretoria (teto absoluto)", hint: "Acima deste valor ninguém aprova: o pedido fica bloqueado." },
];

// Percent with up to two integer and two decimal digits (0 to 99.99), the same shape the server accepts. Text, never `number`.
const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;

/** Accepts the pt-BR comma while typing; the API always receives a dot. */
function normalize(raw: string): string {
  return raw.trim().replace(",", ".");
}

function compare(a: string, b: string): number {
  const [ai = "0", af = ""] = a.split(".");
  const [bi = "0", bf = ""] = b.split(".");
  const integer = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
  if (integer !== 0) return integer;
  return Number.parseInt(af.padEnd(2, "0"), 10) - Number.parseInt(bf.padEnd(2, "0"), 10);
}

/** Problems per field; empty when the three limits are valid and ascending (seller <= manager <= director). */
function validateLimits(form: LimitsForm): Partial<Record<LevelKey, string>> {
  const problems: Partial<Record<LevelKey, string>> = {};
  for (const { key } of FIELDS) {
    const value = normalize(form[key]);
    if (value === "") problems[key] = "Informe o percentual.";
    else if (!PERCENT.test(value)) problems[key] = "Use de 0 a 99,99, com até duas casas decimais.";
  }
  if (problems.seller === undefined && problems.manager === undefined && compare(normalize(form.seller), normalize(form.manager)) > 0) {
    problems.manager = "O limite do gerente não pode ser menor que o do vendedor.";
  }
  if (problems.manager === undefined && problems.director === undefined && compare(normalize(form.manager), normalize(form.director)) > 0) {
    problems.director = "O limite da diretoria não pode ser menor que o do gerente.";
  }
  return problems;
}

/** W-39 (DISC-3): administrator edits the three discount limits. The server enforces role, order and revision. */
export function DiscountLimitsPage() {
  const api = useApi();
  const query = useQuery(discountLimitsQueryOptions(api));

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Limites de desconto" />
        <div aria-busy="true">
          <SkeletonLines lines={4} label="Carregando limites…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Limites de desconto" />
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os limites" />
        </Card>
      </>
    );
  }
  // Remount on a new revision so the fields always start from what the server holds.
  return <LimitsEditor key={query.data.revision} data={query.data} />;
}

function LimitsEditor({ data }: { data: { limits: LimitsForm; provisional: boolean; revision: string; updatedAt: string } }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LimitsForm>({ ...data.limits });
  const [showProblems, setShowProblems] = useState(false);
  const problems = validateLimits(form);
  const hasProblems = Object.keys(problems).length > 0;

  const save = useMutation({
    mutationFn: () =>
      updateDiscountLimits(api, {
        expectedRevision: data.revision,
        limits: { seller: normalize(form.seller), manager: normalize(form.manager), director: normalize(form.director) },
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.discountLimits, saved);
      toast({ title: "Limites de desconto salvos", description: "Valem para os próximos pedidos e para o envio de pedidos já salvos.", tone: "success" });
    },
  });

  const conflict = save.isError && errorCode(save.error) === "version_conflict";
  const failure = save.isError && !conflict ? describeApiError(save.error, "Não foi possível salvar os limites") : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (!hasProblems && !save.isPending) save.mutate();
  };

  return (
    <>
      <PageHeader
        title="Limites de desconto"
        description="Desconto máximo, em percentual, que cada nível aprova. O limite é inclusivo: um pedido com desconto igual ao limite ainda é aprovado naquele nível."
      />
      <div className="flex max-w-2xl flex-col gap-3">
        {data.provisional ? (
          <Alert tone="warning" title="Valores provisórios">
            Estes limites ainda não foram confirmados: ajustar pelo dono. Salve para confirmar os valores desta instalação.
          </Alert>
        ) : null}
        <Card>
          <CardHeader title="Níveis de aprovação" description="Gerente aprova até o limite do gerente; a Diretoria, até o teto." />
          <CardBody>
            <form onSubmit={submit} noValidate aria-label="Limites de desconto" className="flex flex-col gap-3">
              {conflict ? (
                <Alert tone="warning" title="Os limites foram alterados por outra pessoa">
                  Recarregue para ver os valores atuais antes de salvar.
                  <span className="mt-2 block">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        save.reset();
                        void queryClient.invalidateQueries({ queryKey: queryKeys.discountLimits });
                      }}
                    >
                      Recarregar
                    </Button>
                  </span>
                </Alert>
              ) : null}
              {failure ? (
                <Alert tone="danger" title={failure.title}>
                  {failure.description}
                </Alert>
              ) : null}
              {FIELDS.map(({ key, label, hint }) => (
                <FormField key={key} label={`${label} (%)`} required hint={hint} error={showProblems ? problems[key] : undefined}>
                  <Input
                    size="md"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  />
                </FormField>
              ))}
              <div>
                <Button type="submit" variant="primary" loading={save.isPending}>
                  Salvar limites
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
