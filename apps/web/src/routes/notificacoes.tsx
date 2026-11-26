import { Alert, Button, Card, CardBody, DateText, EmptyState, LoadingPanel, PageHeader, StatusBadge, Select, toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QueryError } from "../components/query-error";
import { markNotificationsRead, notificationKeys, notificationsQueryOptions, type NotificationView } from "../lib/api-tasks";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";

/** Where a notification leads. The server only creates notifications for records inside the recipient's scope (P-21). */
export function notificationTarget(item: Pick<NotificationView, "refType" | "refId">): { to: string; params?: Record<string, string> } {
  if (item.refType === "order") return { to: "/pedidos/$orderId", params: { orderId: item.refId } };
  if (item.refType === "task") return { to: "/tarefas" };
  return { to: "/clientes" };
}

/** W-28: central de notificações. */
export function NotificacoesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useQuery(notificationsQueryOptions(api, unreadOnly));
  const mark = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(api, ids),
    onSuccess: async (_data, ids) => {
      if (ids === undefined) toast({ title: "Notificações marcadas como lidas", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
  const failure = mark.isError ? describeApiError(mark.error, "Não foi possível marcar como lida") : null;
  const open = (item: NotificationView) => {
    if (item.readAt === null) mark.mutate([item.id]);
    const target = notificationTarget(item);
    void navigate({ to: target.to as never, params: target.params as never });
  };
  return (
    <>
      <PageHeader
        title="Notificações"
        actions={
          <Button variant="secondary" disabled={mark.isPending || (query.data?.unreadCount ?? 0) === 0} onClick={() => mark.mutate(undefined)}>
            Marcar todas como lidas
          </Button>
        }
      />
      <Select aria-label="Filtro" value={unreadOnly ? "1" : ""} onChange={(event) => setUnreadOnly(event.target.value === "1")}>
        <option value="">Todas</option>
        <option value="1">Não lidas</option>
      </Select>
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.description}
        </Alert>
      ) : null}
      {query.isPending ? (
        <LoadingPanel title="Carregando as notificações…" description="Buscando as notificações." lines={4} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar as notificações" />
        </Card>
      ) : query.data.items.length === 0 ? (
        <EmptyState title="Nenhuma notificação." />
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-border">
              {query.data.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(item)}>
                    <span className={item.readAt === null ? "block font-semibold" : "block"}>{item.title}</span>
                    <span className="block text-sm text-fg-muted">{item.body}</span>
                    <span className="block text-xs text-fg-muted">
                      <DateText value={item.createdAt} withTime />
                    </span>
                  </button>
                  {item.readAt === null ? <StatusBadge tone="info">Nova</StatusBadge> : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
