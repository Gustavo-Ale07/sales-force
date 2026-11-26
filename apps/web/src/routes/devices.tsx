import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DateText,
  FormField,
  Input,
  LoadingPanel,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  type Tone,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { QueryError } from "../components/query-error";
import { decideDevice, updateDeviceSettings } from "../lib/api-mutations";
import { deviceSettingsQueryOptions, devicesQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { describeApiError } from "../lib/error-message";

type DeviceView = ApiSchema<"DeviceView">;

const STATUS: Record<DeviceView["status"], { label: string; tone: Tone }> = {
  pending: { label: "Aguardando aprovação", tone: "warning" },
  approved: { label: "Aprovado", tone: "success" },
  revoked: { label: "Revogado", tone: "danger" },
};

const PLATFORM: Record<DeviceView["platform"], string> = { android: "Android", ios: "iOS" };

/** W-36 (IAM-7/8): approve and revoke devices. Admin sees all; the manager sees the team. The server scopes the list and re-checks every decision. */
export function DevicesPage() {
  const api = useApi();
  const query = useQuery(devicesQueryOptions(api));
  return (
    <>
      <PageHeader title="Aparelhos" />
      {query.isPending ? (
        <LoadingPanel title="Carregando os aparelhos…" description="Buscando os aparelhos cadastrados." lines={5} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os aparelhos" />
        </Card>
      ) : (
        <DevicesTable items={query.data.items} />
      )}
    </>
  );
}

function DevicesTable({ items }: { items: DeviceView[] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "revoke" }) => decideDevice(api, input.id, input.decision),
    onSuccess: async (_data, input) => {
      toast({ title: input.decision === "approve" ? "Aparelho aprovado" : "Aparelho revogado", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });
  const failure = decide.isError ? describeApiError(decide.error, "Não foi possível concluir a ação") : null;
  const busy = decide.isPending ? decide.variables?.id : undefined;

  return (
    <>
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.description}
        </Alert>
      ) : null}
      <Card>
        <Table label="Aparelhos">
          <TableCaption>Aparelhos</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Aparelho</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Último acesso</TableHead>
              <TableHead>Última sincronização</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>Nenhum aparelho cadastrado.</TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell wrap>{item.accountName}</TableCell>
                  <TableCell wrap>
                    {item.label} ({PLATFORM[item.platform]})
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusBadge>
                  </TableCell>
                  <TableCell>
                    <DateText value={item.lastSeenAt} withTime />
                  </TableCell>
                  <TableCell>
                    <DateText value={item.lastSyncAt} withTime fallback="nunca" />
                  </TableCell>
                  <TableCell>
                    {item.canManage ? (
                      <span className="flex gap-2">
                        {item.status === "pending" ? (
                          <Button
                            variant="primary"
                            loading={busy === item.id && decide.variables?.decision === "approve"}
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: item.id, decision: "approve" })}
                          >
                            Aprovar
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          loading={busy === item.id && decide.variables?.decision === "revoke"}
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: item.id, decision: "revoke" })}
                        >
                          Revogar
                        </Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

/** Offline limit and approved devices per account (Configurações, admin only; the server enforces the role). */
export function DeviceSettingsCard() {
  const api = useApi();
  const { data: session } = useQuery(sessionQueryOptions(useAppServices().authClient));
  const isAdmin = session?.role === "admin";
  const query = useQuery({ ...deviceSettingsQueryOptions(api), enabled: isAdmin });
  if (!isAdmin) return null;
  if (query.isPending) return <LoadingPanel title="Carregando…" description="Buscando os limites de aparelhos." lines={2} />;
  if (query.isError) {
    return (
      <Card>
        <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar os limites de aparelhos" />
      </Card>
    );
  }
  return <DeviceSettingsForm initial={query.data} />;
}

const WHOLE = /^\d{1,2}$/;

function DeviceSettingsForm({ initial }: { initial: ApiSchema<"DeviceSettings"> }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [max, setMax] = useState(String(initial.maxActiveDevices));
  const [showProblems, setShowProblems] = useState(false);
  const maxOk = WHOLE.test(max) && Number(max) >= 1 && Number(max) <= 5;
  const save = useMutation({
    mutationFn: () => updateDeviceSettings(api, { maxActiveDevices: Number(max) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.deviceSettings, saved);
      toast({ title: "Limites de aparelhos salvos", tone: "success" });
    },
  });
  const failure = save.isError ? describeApiError(save.error, "Não foi possível salvar") : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (maxOk && !save.isPending) save.mutate();
  };
  return (
    <Card>
      <CardHeader title="Aparelhos" />
      <CardBody>
        <form onSubmit={submit} noValidate aria-label="Limites de aparelhos" className="flex max-w-md flex-col gap-3">
          {failure ? (
            <Alert tone="danger" title={failure.title}>
              {failure.description}
            </Alert>
          ) : null}
          <FormField label="Aparelhos aprovados por usuário" required error={showProblems && !maxOk ? "Use de 1 a 5." : undefined}>
            <Input size="md" inputMode="numeric" autoComplete="off" value={max} onChange={(event) => setMax(event.target.value)} />
          </FormField>
          <div>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Salvar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
