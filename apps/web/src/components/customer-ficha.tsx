import {
  Alert,
  Avatar,
  Card,
  CardBody,
  CardHeader,
  DateText,
  Dialog,
  DialogContent,
  EmptyState,
  KeyValue,
  KeyValueList,
  Money,
  Pagination,
  SkeletonLines,
  StatusDot,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDocument,
  titleCase,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { customerFinancialQueryOptions, customerQueryOptions, ordersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { errorStatus } from "../lib/http-error";
import { orderReference, orderStatusLabels } from "../lib/labels";
import { CustomerStatus } from "../routes/customers";
import { QueryError } from "./query-error";

export type FichaTab = "cadastro" | "financeiro" | "analise" | "engajamento" | "vendas";

const tabs = [
  { value: "cadastro", label: "Dados cadastrais" },
  { value: "financeiro", label: "Financeiro" },
  { value: "analise", label: "Análise do cliente" },
  { value: "engajamento", label: "Engajamento" },
  { value: "vendas", label: "Vendas" },
] as const satisfies readonly { value: FichaTab; label: string }[];

const ORDERS_PAGE_SIZE = 10;

/**
 * The customer is read by the page/editor that hosts the ficha and by several tabs; a short freshness window
 * keeps the tabs from refetching the record the host just loaded.
 */
function useFichaCustomer(customerCode: number) {
  const api = useApi();
  return useQuery({ ...customerQueryOptions(api, customerCode), staleTime: 30_000 });
}

function CustomerOrders({ customerCode }: { customerCode: number }) {
  const api = useApi();
  const [page, setPage] = useState(1);
  const query = useQuery(ordersQueryOptions(api, { customerCode, pageSize: ORDERS_PAGE_SIZE, page, sort: "-updatedAt" }));
  return (
    <Card>
      <CardHeader
        title="Pedidos do cliente"
        actions={
          <Link to="/pedidos" search={{ customerCode }} className="text-accent hover:underline">
            Ver todos
          </Link>
        }
      />
      {query.isPending ? (
        <CardBody aria-busy="true">
          <SkeletonLines lines={3} label="Carregando pedidos do cliente…" />
        </CardBody>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os pedidos" compact />
      ) : query.data.items.length === 0 ? (
        <EmptyState compact title="Nenhum pedido para este cliente" description="Crie um novo pedido para começar." />
      ) : (
        <>
          <Table label="Pedidos do cliente">
            <TableCaption>Pedidos do cliente</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead numeric>Total estimado</TableHead>
                <TableHead>Atualizado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((order) => {
                const status = orderStatusLabels[order.status];
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link to="/pedidos/$id" params={{ id: order.id }} className="font-medium text-accent hover:underline">
                        {orderReference(order)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusDot tone={status.tone}>{status.label}</StatusDot>
                    </TableCell>
                    <TableCell numeric>
                      <Money value={order.estimatedTotal} />
                    </TableCell>
                    <TableCell>
                      <DateText value={order.updatedAt} withTime />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {query.data.total > ORDERS_PAGE_SIZE ? (
            <Pagination page={page} pageSize={ORDERS_PAGE_SIZE} total={query.data.total} onPageChange={setPage} pageSizeOptions={[ORDERS_PAGE_SIZE]} />
          ) : null}
        </>
      )}
    </Card>
  );
}

function RegistrationTab({ customerCode }: { customerCode: number }) {
  const query = useFichaCustomer(customerCode);
  if (query.isPending) {
    return (
      <div aria-busy="true">
        <SkeletonLines lines={6} label="Carregando cliente…" />
      </div>
    );
  }
  if (query.isError) {
    return <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o cliente" />;
  }
  const customer = query.data;
  const resolved = customer.resolvedPriceTable;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados cadastrais" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Código">{customer.code}</KeyValue>
              <KeyValue label="Razão social">{titleCase(customer.name)}</KeyValue>
              <KeyValue label="Nome fantasia">{customer.tradeName ? titleCase(customer.tradeName) : "—"}</KeyValue>
              <KeyValue label="CNPJ/CPF">{formatDocument(customer.document)}</KeyValue>
              <KeyValue label="Vendedor preferencial">{customer.sellerName ?? "—"}</KeyValue>
              <KeyValue label="Última sincronização">
                <DateText value={customer.syncedAt} withTime />
              </KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tabela de preço" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Tabela de preço do cadastro">
                {customer.priceTableCode === null ? "Sem tabela" : `${customer.priceTableCode}${customer.priceTableName ? ` — ${customer.priceTableName}` : ""}`}
              </KeyValue>
              <KeyValue label="Tabela usada nos pedidos">
                {resolved === null ? (
                  <span>Sem tabela resolvida (produtos aparecem como “Sem preço”)</span>
                ) : (
                  `Tabela ${resolved.code} (${resolved.source === "customer" ? "do cliente" : "alternativa da instalação"})`
                )}
              </KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
      </div>
      <Alert tone="info" title="Dados de contato e endereços">
        Telefone, e-mail, classificação ICMS e os endereços (principal, entrega e cobrança) ainda não são sincronizados do Sankhya e por isso não aparecem aqui.
      </Alert>
    </div>
  );
}

/**
 * Read-only financial information mirrored from the ERP (D-I): informational only, never blocks a sale. The server decides what
 * exists (limits, overdue); a 404 means this installation does not show the financial area.
 */
function FinanceTab({ customerCode }: { customerCode: number }) {
  const api = useApi();
  const query = useQuery({ ...customerFinancialQueryOptions(api, customerCode), staleTime: 30_000 });
  if (query.isPending) {
    return (
      <div aria-busy="true">
        <SkeletonLines lines={3} label="Carregando dados financeiros…" />
      </div>
    );
  }
  if (query.isError) {
    if (errorStatus(query.error) === 404) {
      return (
        <Alert tone="info" title="Financeiro indisponível">
          A área financeira não está habilitada nesta instalação.
        </Alert>
      );
    }
    return <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o financeiro" />;
  }
  const data = query.data;
  const { summary } = data;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader title="Situação financeira" />
        <CardBody>
          <KeyValueList>
            {/* The server sends the limits only when the installation allows it. */}
            {data.creditLimit === null ? null : (
              <KeyValue label="Limite de crédito">
                <Money value={data.creditLimit} />
              </KeyValue>
            )}
            {data.monthlyCreditLimit === null ? null : (
              <KeyValue label="Limite mensal">
                <Money value={data.monthlyCreditLimit} />
              </KeyValue>
            )}
            <KeyValue label="Em aberto">
              {summary.openCount} {summary.openCount === 1 ? "título" : "títulos"} · <Money value={summary.openAmount} />
            </KeyValue>
            {summary.overdueCount === null || summary.overdueAmount === null ? null : (
              <KeyValue label="Vencido">
                {summary.overdueCount === 0 ? (
                  "Nenhum título vencido"
                ) : (
                  <span className="text-danger">
                    {summary.overdueCount} {summary.overdueCount === 1 ? "título" : "títulos"} · <Money value={summary.overdueAmount} />
                    {summary.oldestOverdueDueDate ? (
                      <>
                        {" "}
                        · mais antigo venceu em <DateText value={summary.oldestOverdueDueDate} timeZone="UTC" />
                      </>
                    ) : null}
                  </span>
                )}
              </KeyValue>
            )}
            <KeyValue label="Bloqueio">
              {data.blocked ? (
                <span className="text-danger">Bloqueado{data.blockReason ? ` — ${data.blockReason}` : ""}</span>
              ) : (
                "Sem bloqueio"
              )}
            </KeyValue>
          </KeyValueList>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Títulos em aberto" />
        {data.titles.length === 0 ? (
          <CardBody>
            <EmptyState compact title="Nenhum título em aberto" description="O Sankhya não informa títulos a receber em aberto para este cliente." />
          </CardBody>
        ) : (
          <Table label="Títulos em aberto">
            <TableCaption>Títulos a receber em aberto, por vencimento</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead numeric>Valor</TableHead>
                <TableHead numeric>Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.titles.map((title) => (
                <TableRow key={title.nufin}>
                  <TableCell>
                    <DateText value={title.dueDate} timeZone="UTC" />
                    {title.overdue ? <StatusDot tone="danger">Vencido</StatusDot> : null}
                  </TableCell>
                  <TableCell>{title.documentNumber ?? <span className="text-fg-faint">—</span>}</TableCell>
                  <TableCell numeric>
                    <Money value={title.amount} />
                  </TableCell>
                  <TableCell numeric>
                    <Money value={title.balance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-fg-muted">
        Informação do Sankhya em <DateText value={data.checkedAt} withTime />. Somente consulta: não bloqueia vendas.
      </p>
    </div>
  );
}

function UnavailableTab({ title, description }: { title: string; description: string }) {
  return <EmptyState compact title={title} description={description} />;
}

export interface CustomerFichaTabsProps {
  customerCode: number;
  /** Tab open on first render. */
  initialTab?: FichaTab;
}

/** The five tabs of the "Ficha do Cliente" (Vidya parity). Shared by the modal and the customer page. */
export function CustomerFichaTabs({ customerCode, initialTab = "cadastro" }: CustomerFichaTabsProps) {
  return (
    <Tabs defaultValue={initialTab}>
      <TabsList aria-label="Ficha do cliente">
        {tabs.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} className="tracking-normal">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="cadastro">
        <RegistrationTab customerCode={customerCode} />
      </TabsContent>
      <TabsContent value="financeiro">
        <FinanceTab customerCode={customerCode} />
      </TabsContent>
      <TabsContent value="analise">
        <UnavailableTab title="Análise do cliente" description="O conteúdo desta aba ainda não foi definido." />
      </TabsContent>
      <TabsContent value="engajamento">
        <UnavailableTab title="Engajamento indisponível" description="A regra de engajamento e positivação ainda não foi definida." />
      </TabsContent>
      <TabsContent value="vendas">
        <CustomerOrders customerCode={customerCode} />
      </TabsContent>
    </Tabs>
  );
}

function FichaHeader({ customerCode }: { customerCode: number }) {
  const query = useFichaCustomer(customerCode);
  const customer = query.data;
  return (
    <span className="flex items-center gap-2">
      {customer ? <Avatar name={customer.name} seed={String(customer.code)} size="md" className="rounded-full" aria-hidden="true" role="presentation" /> : null}
      <span className="min-w-0 truncate">{customer ? `${customer.code} – ${titleCase(customer.name)}` : `Cliente ${customerCode}`}</span>
      {customer ? <CustomerStatus active={customer.active} blocked={customer.blocked} /> : null}
    </span>
  );
}

export interface CustomerFichaDialogProps {
  customerCode: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: FichaTab;
}

/** "Ficha do Cliente": large modal over the current screen, so the seller does not lose the order in progress. */
export function CustomerFichaDialog({ customerCode, open, onOpenChange, initialTab }: CustomerFichaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={<FichaHeader customerCode={customerCode} />}
        className="h-[85vh] max-w-5xl"
      >
        <CustomerFichaTabs customerCode={customerCode} initialTab={initialTab} />
      </DialogContent>
    </Dialog>
  );
}
