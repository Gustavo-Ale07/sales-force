import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DateText,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  SkeletonLines,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { createOrderFromTemplate, deleteOrderTemplate } from "../lib/api-mutations";
import { orderTemplatesQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { errorStatus } from "../lib/http-error";
import { formatCount } from "../lib/labels";
import { describeTemplateError, skippedLinesOf } from "../lib/order-templates";
import { OrderTemplateEditDialog } from "./order-template-edit-dialog";
import { QueryError } from "./query-error";
import { TemplateSkippedNotice } from "./template-skipped-notice";

type OrderTemplate = ApiSchema<"OrderTemplate">;

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

function CorrelationId({ id }: { id: string | undefined }) {
  return id ? (
    <span className="mt-1 block text-xs">
      Código de correlação: <span className="font-mono">{id}</span>
    </span>
  ) : null;
}

function DeleteTemplateDialog({ template, onClose }: { template: OrderTemplate | null; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => deleteOrderTemplate(api, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplatesAll });
      toast({ title: "Modelo apagado", description: template?.name, tone: "success" });
      onClose();
    },
    // Already gone (deleted elsewhere): the list must not keep showing it.
    onError: (error) => {
      if (errorStatus(error) === 404) void queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplatesAll });
    },
  });
  const failure = mutation.isError ? describeTemplateError(mutation.error, "Não foi possível apagar o modelo") : undefined;
  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => {
        if (!open) {
          mutation.reset();
          onClose();
        }
      }}
    >
      <DialogContent
        title="Apagar modelo recorrente?"
        description={template ? `O modelo “${template.name}” será apagado. Pedidos já criados a partir dele não são afetados.` : undefined}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Manter modelo</Button>
            </DialogClose>
            <Button variant="danger" loading={mutation.isPending} onClick={() => template && mutation.mutate(template.id)}>
              Apagar
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            <CorrelationId id={failure.correlationId} />
          </Alert>
        ) : (
          <p className="m-0 text-sm text-fg-muted">Esta ação não pode ser desfeita pela interface.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface OrderTemplatesCardProps {
  customerCode: number;
}

/** "Pedidos recorrentes" of one customer: use (new draft), edit, delete. Templates hold product + quantity only. */
export function OrderTemplatesCard({ customerCode }: OrderTemplatesCardProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(orderTemplatesQueryOptions(api, customerCode));
  const [editing, setEditing] = useState<OrderTemplate | null>(null);
  const [deleting, setDeleting] = useState<OrderTemplate | null>(null);

  // The request id is the new draft's own idempotency key. It is kept per template while the previous attempt ended in an
  // unknown outcome (network error, 5xx, 429), so a retry after a lost response cannot create a second draft. It is dropped
  // on success and on every definitive answer (409, 404, other 4xx): the next click is then a genuinely new attempt.
  const requestIds = useRef(new Map<string, string>());
  const use = useMutation({
    mutationFn: (template: OrderTemplate) => {
      let clientRequestId = requestIds.current.get(template.id);
      if (!clientRequestId) {
        clientRequestId = newUuid();
        requestIds.current.set(template.id, clientRequestId);
      }
      return createOrderFromTemplate(api, template.id, { clientRequestId });
    },
    onError: (error, template) => {
      const status = errorStatus(error);
      const unknownOutcome = status === undefined || status === 0 || status >= 500 || status === 429;
      if (!unknownOutcome) requestIds.current.delete(template.id);
      // The template changed or is gone: the list on screen is stale.
      if (status === 404 || describeTemplateError(error, "", "use").reason === "version_conflict") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplates(customerCode) });
      }
    },
    onSuccess: async (result, template) => {
      requestIds.current.delete(template.id);
      queryClient.setQueryData(queryKeys.order(result.order.id), result.order);
      // Refreshing other screens must not delay opening the new draft.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      if (result.skippedLines.length === 0) {
        toast({ title: "Rascunho criado a partir do modelo", description: template.name, tone: "success" });
      }
      await navigate({
        to: "/pedidos/$id",
        params: { id: result.order.id },
        state: { orderNotice: { source: "template", templateName: template.name, skippedLines: result.skippedLines } },
      });
    },
  });

  const useFailure = use.isError ? describeTemplateError(use.error, "Não foi possível criar o pedido", "use") : undefined;
  const templates = query.data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Pedidos recorrentes"
        description="Listas de produtos e quantidades para repetir. Os preços são os de hoje, aplicados ao criar o pedido."
      />
      {useFailure ? (
        <CardBody className="border-b border-line">
          <Alert tone="danger" title={useFailure.title} onDismiss={() => use.reset()}>
            {useFailure.description}
            <CorrelationId id={useFailure.correlationId} />
          </Alert>
          {useFailure.reason === "no_usable_lines" ? <TemplateSkippedNotice lines={skippedLinesOf(use.error)} /> : null}
        </CardBody>
      ) : null}
      {query.isPending ? (
        <CardBody aria-busy="true">
          <SkeletonLines lines={3} label="Carregando pedidos recorrentes…" />
        </CardBody>
      ) : query.isError ? (
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
          title="Não foi possível carregar os pedidos recorrentes"
          compact
        />
      ) : templates.length === 0 ? (
        <EmptyState
          compact
          title="Nenhum pedido recorrente para este cliente"
          description="Monte um pedido e use “Salvar como recorrente” no editor para repeti-lo depois com um clique."
        />
      ) : (
        <Table label="Pedidos recorrentes do cliente">
          <TableCaption>Pedidos recorrentes do cliente</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead numeric>Itens</TableHead>
              <TableHead>Atualizado em</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell wrap className="font-medium">
                  {template.name}
                </TableCell>
                <TableCell numeric>{formatCount(template.itemCount)}</TableCell>
                <TableCell>
                  <DateText value={template.updatedAt} withTime />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="primary"
                      leftIcon={<Play size={12} aria-hidden="true" />}
                      aria-label={`Usar modelo ${template.name}`}
                      loading={use.isPending && use.variables?.id === template.id}
                      disabled={use.isPending}
                      onClick={() => use.mutate(template)}
                    >
                      Usar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Pencil size={12} aria-hidden="true" />}
                      aria-label={`Editar modelo ${template.name}`}
                      onClick={() => setEditing(template)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-outline"
                      leftIcon={<Trash2 size={12} aria-hidden="true" />}
                      aria-label={`Apagar modelo ${template.name}`}
                      onClick={() => setDeleting(template)}
                    >
                      Apagar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <OrderTemplateEditDialog customerCode={customerCode} template={editing} onClose={() => setEditing(null)} />
      <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
}
