import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DateText,
  EmptyState,
  KeyValue,
  KeyValueList,
  PageHeader,
  SkeletonLines,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type Tone,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "../components/query-error";
import { configurationQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { formatCount } from "../lib/labels";

const integrationLabels: Record<ApiSchema<"IntegrationSummary">["state"], { label: string; tone: Tone }> = {
  ok: { label: "Normal", tone: "success" },
  degraded: { label: "Degradada", tone: "warning" },
  not_configured: { label: "Não configurada", tone: "neutral" },
};

const syncStatusLabels: Record<ApiSchema<"SyncStatus">, { label: string; tone: Tone }> = {
  idle: { label: "Aguardando", tone: "neutral" },
  running: { label: "Em execução", tone: "info" },
  succeeded: { label: "Concluída", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
};

const gatewayLabels: Record<ApiSchema<"GatewayMode">, string> = {
  fake: "Demonstração (dados de exemplo)",
  live: "ERP conectado",
};

const sourceLabels: Record<ApiSchema<"ConfigurationSourceKind">, string> = {
  sankhya: "ERP (Sankhya)",
  "bootstrap-file": "Arquivo de instalação",
  demo: "Demonstração",
};

const yesNo = (value: boolean) => (value ? "Sim" : "Não");

/** Read-only view of `GET /configuration`: nothing here is editable in this phase. */
export function IntegrationPage() {
  const api = useApi();
  const query = useQuery(configurationQueryOptions(api));

  return (
    <>
      <PageHeader title="Integração e configuração" description="Estado da integração com o ERP e da configuração desta instalação (somente leitura)." />
      {query.isPending ? (
        <div aria-busy="true">
          <SkeletonLines lines={8} label="Carregando configuração…" />
        </div>
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar a configuração" />
        </Card>
      ) : (
        <ConfigurationView data={query.data} />
      )}
    </>
  );
}

function ConfigurationView({ data }: { data: ApiSchema<"ConfigurationResponse"> }) {
  const { configuration: config, integration, gateway, syncStates } = data;
  const state = integrationLabels[integration.state];
  return (
    <>
      {gateway.mode === "fake" ? (
        <Alert tone="warning" title="Dados de demonstração">
          Esta instalação usa dados de exemplo; nada aqui vem do ERP real.
        </Alert>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Integração" actions={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>} />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Modo">{gatewayLabels[gateway.mode]}</KeyValue>
              <KeyValue label="Última sincronização com sucesso">
                <DateText value={integration.lastSuccessAt} withTime fallback="Nunca" />
              </KeyValue>
              <KeyValue label="Entidades com falha">{integration.failingEntities.length === 0 ? "Nenhuma" : integration.failingEntities.join(", ")}</KeyValue>
              {integration.message ? <KeyValue label="Mensagem">{integration.message}</KeyValue> : null}
            </KeyValueList>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Configuração da instalação" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Origem">{sourceLabels[config.source.kind]}</KeyValue>
              <KeyValue label="Versão">{config.source.version}</KeyValue>
              <KeyValue label="Atualizada em">
                <DateText value={config.source.syncedAt} withTime />
              </KeyValue>
              <KeyValue label="Pedidos habilitados">{yesNo(config.general.enabled)}</KeyValue>
              <KeyValue label="Empresas habilitadas">{formatCount(config.general.enabledCompanyCodes.length)}</KeyValue>
              <KeyValue label="Tipos de negociação">{formatCount(config.sales.negotiationTypes.length)}</KeyValue>
              <KeyValue label="Rascunho sem preço">{yesNo(config.sales.orderBehavior.allowDraftWithoutPrice)}</KeyValue>
              <KeyValue label="Produto sem preço visível">{yesNo(config.products.productWithoutPrice.visible)}</KeyValue>
              <KeyValue label="Produto sem preço pode ser pedido">{yesNo(config.products.productWithoutPrice.orderable)}</KeyValue>
              <KeyValue label="Exibe limite de crédito">{yesNo(config.customers.creditFeatures.showCreditLimit)}</KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Sincronização por entidade" />
        {syncStates.length === 0 ? (
          <EmptyState compact title="Sem sincronizações registradas" description="As entidades aparecem aqui após a primeira sincronização." />
        ) : (
          <Table label="Sincronização por entidade">
            <TableCaption>Sincronização por entidade</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Entidade</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Última com sucesso</TableHead>
                <TableHead>Última tentativa</TableHead>
                <TableHead numeric>Registros</TableHead>
                <TableHead>Último erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {syncStates.map((sync) => {
                const status = syncStatusLabels[sync.status];
                return (
                  <TableRow key={sync.entity}>
                    <TableCell>{sync.entity}</TableCell>
                    <TableCell>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <DateText value={sync.lastSuccessAt} withTime fallback="Nunca" />
                    </TableCell>
                    <TableCell>
                      <DateText value={sync.lastAttemptAt} withTime fallback="—" />
                    </TableCell>
                    <TableCell numeric>{sync.rowCount === null ? "—" : formatCount(sync.rowCount)}</TableCell>
                    <TableCell wrap>
                      {sync.lastErrorClass ? (
                        <span>
                          <Badge tone="danger">{sync.lastErrorClass}</Badge>
                          {sync.lastErrorMessage ? <span className="ml-1 text-fg-muted">{sync.lastErrorMessage}</span> : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
