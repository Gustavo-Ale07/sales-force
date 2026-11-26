import {
  Alert,
  Button,
  Card,
  CardBody,
  DateText,
  EmptyState,
  FormField,
  Input,
  LoadingPanel,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
  type Tone,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { QueryError } from "../components/query-error";
import { cancelTask, completeTask, createTask, taskKeys, tasksQueryOptions, type TaskView } from "../lib/api-tasks";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";

const TYPE_LABEL: Record<TaskView["type"], string> = {
  call: "Ligação",
  visit: "Visita",
  email: "E-mail",
  whatsapp: "WhatsApp",
  meeting: "Reunião",
  other: "Outro",
};
const STATUS: Record<TaskView["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pendente", tone: "warning" },
  completed: { label: "Concluída", tone: "success" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};
const REMINDERS: { value: string; label: string }[] = [
  { value: "", label: "Sem lembrete" },
  { value: "0", label: "No horário" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

type Filter = "all" | "pending" | "completed" | "cancelled";

/** W-26: tarefas. The server scopes the list (seller: own; manager and admin: all) and re-checks every action. */
export function TarefasPage() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>("pending");
  const [onlyLate, setOnlyLate] = useState(false);
  const [type, setType] = useState<"" | TaskView["type"]>("");
  const query = useQuery(tasksQueryOptions(api, filter));
  return (
    <>
      <PageHeader title="Tarefas" />
      <NewTaskForm />
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-3">
            <FormField label="Situação">
              <Select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                <option value="pending">Pendentes</option>
                <option value="completed">Concluídas</option>
                <option value="cancelled">Canceladas</option>
                <option value="all">Todas</option>
              </Select>
            </FormField>
            <FormField label="Tipo">
              <Select value={type} onChange={(event) => setType(event.target.value as "" | TaskView["type"])}>
                <option value="">Todos</option>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Atrasadas">
              <Select value={onlyLate ? "1" : ""} onChange={(event) => setOnlyLate(event.target.value === "1")}>
                <option value="">Todas</option>
                <option value="1">Somente atrasadas</option>
              </Select>
            </FormField>
          </div>
        </CardBody>
      </Card>
      {query.isPending ? (
        <LoadingPanel title="Carregando as tarefas…" description="Buscando as tarefas." lines={5} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar as tarefas" />
        </Card>
      ) : (
        <TasksTable items={filterTasks(query.data.items, type, onlyLate, query.dataUpdatedAt)} now={query.dataUpdatedAt} />
      )}
    </>
  );
}

export function isLate(task: Pick<TaskView, "status" | "dueAt">, now: number): boolean {
  return task.status === "pending" && Date.parse(task.dueAt) < now;
}

export function filterTasks(items: readonly TaskView[], type: "" | TaskView["type"], onlyLate: boolean, now: number): TaskView[] {
  return items.filter((task) => (type === "" || task.type === type) && (!onlyLate || isLate(task, now)));
}

function NewTaskForm() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (form: FormData) => {
      const due = new Date(String(form.get("dueAt")));
      if (Number.isNaN(due.getTime())) throw new Error("Informe a data e a hora da tarefa.");
      const lead = String(form.get("lead") ?? "");
      const customer = String(form.get("customer") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();
      return createTask(api, {
        id: crypto.randomUUID(),
        type: String(form.get("type")) as TaskView["type"],
        title: String(form.get("title") ?? "").trim(),
        description: description === "" ? null : description,
        dueAt: due.toISOString(),
        reminderLeadMinutes: lead === "" ? null : Number(lead),
        customerCode: customer === "" ? null : Number(customer),
      });
    },
    onSuccess: async () => {
      toast({ title: "Tarefa criada", tone: "success" });
      setOpen(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (failure) => setError(describeApiError(failure, "Não foi possível criar a tarefa").description ?? "Não foi possível criar a tarefa."),
  });
  if (!open) {
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Nova tarefa
        </Button>
      </div>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(new FormData(event.currentTarget));
  };
  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tipo" required>
            <Select name="type" defaultValue="call">
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Título" required>
            <Input name="title" maxLength={120} required />
          </FormField>
          <FormField label="Data e hora" required>
            <Input name="dueAt" type="datetime-local" required />
          </FormField>
          <FormField label="Lembrete">
            <Select name="lead" defaultValue="30">
              {REMINDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Código do cliente">
            <Input name="customer" inputMode="numeric" pattern="[0-9]*" />
          </FormField>
          <FormField label="Descrição">
            <Textarea name="description" maxLength={2000} rows={2} />
          </FormField>
          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger" title="Tarefa não criada">
                {error}
              </Alert>
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" loading={create.isPending}>
              Salvar
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function TasksTable({ items, now }: { items: TaskView[]; now: number }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (input: { id: string; action: "complete" | "cancel" }) => (input.action === "complete" ? completeTask(api, input.id) : cancelTask(api, input.id)),
    onSuccess: async (_data, input) => {
      toast({ title: input.action === "complete" ? "Tarefa concluída" : "Tarefa cancelada", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  const failure = act.isError ? describeApiError(act.error, "Não foi possível concluir a ação") : null;
  if (items.length === 0) return <EmptyState title="Nenhuma tarefa." />;
  return (
    <>
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.description}
        </Alert>
      ) : null}
      <Card>
        <Table label="Tarefas">
          <TableCaption>Tarefas</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data e hora</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((task) => (
              <TableRow key={task.id}>
                <TableCell>{TYPE_LABEL[task.type]}</TableCell>
                <TableCell wrap>{task.title}</TableCell>
                <TableCell wrap>{task.customerName ?? ""}</TableCell>
                <TableCell>
                  <span className={isLate(task, now) ? "font-semibold text-danger" : undefined}>
                    <DateText value={task.dueAt} withTime />
                  </span>
                </TableCell>
                <TableCell wrap>{task.assigneeName}</TableCell>
                <TableCell>
                  <StatusBadge tone={isLate(task, now) ? "danger" : STATUS[task.status].tone}>{isLate(task, now) ? "Atrasada" : STATUS[task.status].label}</StatusBadge>
                </TableCell>
                <TableCell>
                  {task.status === "pending" ? (
                    <span className="flex gap-2">
                      <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate({ id: task.id, action: "complete" })}>
                        Concluir
                      </Button>
                      <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: task.id, action: "cancel" })}>
                        Cancelar
                      </Button>
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
