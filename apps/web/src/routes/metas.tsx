import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Card,
  CardBody,
  DateText,
  EmptyState,
  LoadingPanel,
  Money,
  PageHeader,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "../components/query-error";
import { goalsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";

type GoalFigure = ApiSchema<"GoalFigure">;
type Positivation = ApiSchema<"PositivationFigure">;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const NONE = "—";

export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTHS[Number(number) - 1] ?? month} de ${year}`;
}

function percentText(percent: string | null): string {
  return percent === null ? NONE : `${percent.replace(".", ",")}%`;
}

function MoneyOrNone({ value }: { value: string | null }) {
  return value === null ? <span>{NONE}</span> : <Money value={value} />;
}

function QuantityText({ value }: { value: string | null }) {
  if (value === null) return <span>{NONE}</span>;
  return <span>{Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</span>;
}

function positivationText(figure: Positivation | null): string {
  return figure === null ? NONE : `${figure.positivated} de ${figure.total}`;
}

/** Metas e positivação do mês (W-23, RF-GOL-1/2): meta e realizado vêm do espelho do ERP; o vendedor vê o próprio resultado, gerente e administrador veem a equipe. */
export function MetasPage() {
  const api = useApi();
  const query = useQuery(goalsQueryOptions(api));

  return (
    <>
      <PageHeader
        title="Metas"
        description={query.data ? <span>{monthLabel(query.data.month)}</span> : undefined}
      />
      {query.isPending ? (
        <LoadingPanel title="Carregando metas…" lines={5} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        </Card>
      ) : (
        <>
          <StatGrid variant="tiles" className="sm:grid-cols-4">
            <StatTile label="Meta do mês" value={<MoneyOrNone value={query.data.total.revenue.target} />} />
            <StatTile label="Realizado" value={<MoneyOrNone value={query.data.total.revenue.realized} />} />
            <StatTile label="Atingido" value={percentText(query.data.total.revenue.percent)} />
            <StatTile
              label="Positivação"
              value={`${positivationText(query.data.total.positivation)} (${percentText(query.data.total.positivation?.percent ?? null)})`}
            />
          </StatGrid>
          <p className="mt-2 text-xs text-muted-foreground">
            Metas atualizadas em <DateText value={query.data.goalsSyncedAt} withTime fallback="nunca" /> · Vendas em{" "}
            <DateText value={query.data.salesSyncedAt} withTime fallback="nunca" />
          </p>
          {query.data.bySeller.length === 0 ? (
            query.data.total.revenue.target === null ? (
              <Card className="mt-4">
                <EmptyState title="Sem meta no mês" />
              </Card>
            ) : null
          ) : (
            <Card className="mt-4">
              <CardBody>
                <Table label="Metas por vendedor">
                  <TableCaption>Metas por vendedor</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Meta</TableHead>
                      <TableHead>Realizado</TableHead>
                      <TableHead>Atingido</TableHead>
                      <TableHead>Meta (quantidade)</TableHead>
                      <TableHead>Positivação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.bySeller.map((row) => (
                      <TableRow key={row.sellerCode}>
                        <TableCell>{row.sellerName ?? row.sellerCode}</TableCell>
                        <TableCell>
                          <MoneyOrNone value={(row.revenue as GoalFigure).target} />
                        </TableCell>
                        <TableCell>
                          <MoneyOrNone value={row.revenue.realized} />
                        </TableCell>
                        <TableCell>{percentText(row.revenue.percent)}</TableCell>
                        <TableCell>
                          <QuantityText value={row.quantity.target} />
                        </TableCell>
                        <TableCell>
                          {positivationText(row.positivation)} ({percentText(row.positivation?.percent ?? null)})
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </>
  );
}
