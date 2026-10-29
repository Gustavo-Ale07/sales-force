import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Card,
  DateText,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  FormField,
  Money,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableLoadingRows,
  TableMessageRow,
  TableRow,
  Textarea,
  toast,
  titleCase,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { QueryError } from "../components/query-error";
import { approveApproval, rejectApproval } from "../lib/api-mutations";
import { approvalsQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { describeApiError } from "../lib/error-message";
import { formatCount } from "../lib/labels";

type QueueItem = ApiSchema<"ApprovalQueueItem">;

const COLUMNS = 8;
const COMMENT_MAX = 500;

/** The level is shown as the people see it: the admin approves the director level, labelled "Diretoria" (Q6). */
export const approvalLevelLabels: Record<ApiSchema<"ApprovalLevel">, string> = { manager: "Gerente", director: "Diretoria" };

/** Percent as pt-BR text from the API's decimal string (text, never a JS number). */
function percentText(value: string): string {
  return `${value.replace(".", ",")}%`;
}

type Decision = { item: QueueItem; kind: "approve" | "reject" } | null;

/** W-20: the discount approval queue. Online only; the server enforces the level pool and the order state. */
export function ApprovalsPage() {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [decision, setDecision] = useState<Decision>(null);
  const query = useQuery(approvalsQueryOptions(api, page, pageSize));
  const { authClient } = useAppServices();
  const session = useQuery(sessionQueryOptions(authClient));
  const isAdmin = session.data?.role === "admin";

  return (
    <>
      <PageHeader
        title="Aprovações de desconto"
        description={
          isAdmin
            ? "Pedidos aguardando o nível Diretoria. Aprovar ou reprovar é uma ação explícita e fica registrada com o seu nome."
            : "Pedidos aguardando o nível Gerente. Aprovar ou reprovar é uma ação explícita e fica registrada com o seu nome."
        }
      />
      <Card>
        <Table label="Aprovações pendentes">
          <TableCaption>Solicitações de aprovação de desconto, mais antigas primeiro</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Nível</TableHead>
              <TableHead numeric>Maior desconto</TableHead>
              <TableHead numeric>Total estimado</TableHead>
              <TableHead>Solicitado em</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <TableLoadingRows columns={COLUMNS} />
            ) : query.isError ? (
              <TableMessageRow colSpan={COLUMNS}>
                <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact />
              </TableMessageRow>
            ) : query.data.items.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>
                <EmptyState compact title="Nenhuma aprovação pendente" description="Quando um vendedor enviar um pedido acima do limite dele, ele aparece aqui." />
              </TableMessageRow>
            ) : (
              query.data.items.map((item) => (
                <TableRow key={item.approvalId}>
                  <TableCell>
                    <Link to="/pedidos/$id" params={{ id: item.orderId }} className="font-medium underline-offset-2 hover:underline">
                      {`Rascunho nº ${item.draftNumber}`}
                    </Link>
                    <span className="block text-xs text-fg-muted">{`${formatCount(item.itemCount)} ${item.itemCount === 1 ? "item" : "itens"}`}</span>
                  </TableCell>
                  <TableCell wrap className="min-w-[10rem]">
                    {titleCase(item.customerName)}
                  </TableCell>
                  <TableCell>{item.ownerName}</TableCell>
                  <TableCell>{approvalLevelLabels[item.requestedLevel]}</TableCell>
                  <TableCell numeric>{percentText(item.maxDiscountPercent)}</TableCell>
                  <TableCell numeric>
                    <Money value={item.estimatedTotal} />
                  </TableCell>
                  <TableCell>
                    <DateText value={item.requestedAt} withTime />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" aria-label={`Aprovar rascunho nº ${item.draftNumber}`} onClick={() => setDecision({ item, kind: "approve" })}>
                        Aprovar
                      </Button>
                      <Button size="sm" variant="danger-outline" aria-label={`Reprovar rascunho nº ${item.draftNumber}`} onClick={() => setDecision({ item, kind: "reject" })}>
                        Reprovar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {query.data ? (
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        ) : null}
      </Card>
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

function DecisionDialog({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [showProblem, setShowProblem] = useState(false);
  const reject = decision?.kind === "reject";
  const trimmed = comment.trim();

  const mutation = useMutation({
    mutationFn: () => {
      if (!decision) throw new Error("Nenhuma solicitação selecionada.");
      return reject ? rejectApproval(api, decision.item.approvalId, trimmed) : approveApproval(api, decision.item.approvalId, trimmed === "" ? undefined : trimmed);
    },
    onSuccess: async () => {
      toast({ title: reject ? "Desconto reprovado" : "Desconto aprovado", description: `Rascunho nº ${decision?.item.draftNumber}`, tone: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      close();
    },
    onError: async () => {
      // A request that is no longer pending (decided elsewhere, edited by the seller) leaves the queue on refresh.
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
    },
  });

  function close() {
    setComment("");
    setShowProblem(false);
    mutation.reset();
    onClose();
  }

  const failure = mutation.isError ? describeApiError(mutation.error, reject ? "Não foi possível reprovar" : "Não foi possível aprovar") : null;
  const missingComment = reject && trimmed === "";

  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title={reject ? "Reprovar desconto?" : "Aprovar desconto?"}
        description={
          decision
            ? `Rascunho nº ${decision.item.draftNumber}, desconto de até ${percentText(decision.item.maxDiscountPercent)}. A decisão fica registrada com o seu nome e a data.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button
              variant={reject ? "danger" : "primary"}
              loading={mutation.isPending}
              onClick={() => {
                if (missingComment) {
                  setShowProblem(true);
                  return;
                }
                mutation.mutate();
              }}
            >
              {reject ? "Reprovar" : "Aprovar"}
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
          </Alert>
        ) : null}
        <FormField
          label="Comentário"
          required={reject}
          hint={reject ? "Obrigatório: o vendedor lê o motivo." : "Opcional."}
          error={showProblem && missingComment ? "Informe o motivo da reprovação." : undefined}
        >
          <Textarea value={comment} maxLength={COMMENT_MAX} onChange={(event) => setComment(event.target.value)} />
        </FormField>
      </DialogContent>
    </Dialog>
  );
}
