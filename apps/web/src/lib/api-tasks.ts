import type { ApiSchema } from "@salesforce/contracts/client";
import { queryOptions } from "@tanstack/react-query";
import { callApi, type ApiClient } from "./api";

/** W-26 tarefas e W-28 central de notificações (RF-ACT, RF-NOT). The server scopes both lists; nothing here is authorization. */

export type TaskView = ApiSchema<"Task">;
export type CreateTaskBody = ApiSchema<"CreateTaskRequest">;
export type NotificationView = ApiSchema<"Notification">;

export const taskKeys = {
  all: ["tasks"] as const,
  list: (status: string) => ["tasks", "list", status] as const,
};
export const notificationKeys = {
  all: ["notifications"] as const,
  list: (unreadOnly: boolean) => ["notifications", "list", unreadOnly] as const,
  unread: ["notifications", "unread"] as const,
};

export function tasksQueryOptions(api: ApiClient, status: "all" | "pending" | "completed" | "cancelled") {
  return queryOptions({
    queryKey: taskKeys.list(status),
    queryFn: () => callApi(() => api.GET("/tasks", { params: { query: status === "all" ? { limit: 200 } : { status, limit: 200 } } })),
  });
}

export function createTask(api: ApiClient, body: CreateTaskBody) {
  return callApi(() => api.POST("/tasks", { body }));
}

export function completeTask(api: ApiClient, id: string) {
  return callApi(() => api.POST("/tasks/{id}/complete", { params: { path: { id } }, body: {} }));
}

export function cancelTask(api: ApiClient, id: string) {
  return callApi(() => api.POST("/tasks/{id}/cancel", { params: { path: { id } } }));
}

export function notificationsQueryOptions(api: ApiClient, unreadOnly: boolean) {
  return queryOptions({
    queryKey: notificationKeys.list(unreadOnly),
    queryFn: () => callApi(() => api.GET("/notifications", { params: { query: unreadOnly ? { unreadOnly: "true", limit: 100 } : { limit: 100 } } })),
    refetchInterval: 60_000,
  });
}

export function markNotificationsRead(api: ApiClient, ids?: string[]) {
  return callApi(() => api.POST("/notifications/read", { body: ids === undefined ? {} : { ids } }));
}
