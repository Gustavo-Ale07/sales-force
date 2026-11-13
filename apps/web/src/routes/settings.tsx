import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DateText,
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
  type Tone,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { QueryError } from "../components/query-error";
import { configurationQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";

type Configuration = ApiSchema<"ConfigurationSummary">;
type Provenance = NonNullable<Configuration["provenance"]>;

interface SettingRow {
  /** Dotted key of the configuration; also the key of its provenance entry. */
  readonly key: string;
  readonly label: string;
  readonly value: string;
}
interface SettingGroup {
  readonly title: string;
  readonly rows: readonly SettingRow[];
}

const NONE = "—";
const yesNo = (value: boolean | undefined) => (value === undefined ? NONE : value ? "Sim" : "Não");
const codes = (list: readonly number[] | undefined) => (list === undefined ? NONE : list.length === 0 ? "Nenhum" : list.join(", "));
const text = (value: string | number | null | undefined) => (value === undefined || value === null ? NONE : String(value));

const fallbackStrategyLabels: Record<string, string> = { none: "Sem preço alternativo" };

/** The values of the current snapshot, grouped as on the screen (CFG-7: this whole response is admin/technical only). */
export function settingGroups(config: Configuration): SettingGroup[] {
  const alternative = config.pricing.alternativeTable;
  return [
    {
      title: "Geral",
      rows: [
        { key: "general.enabled", label: "Pedidos habilitados", value: yesNo(config.general.enabled) },
        { key: "general.enabledCompanyCodes", label: "Empresas habilitadas", value: codes(config.general.enabledCompanyCodes) },
        { key: "general.appMinimumVersion", label: "Versão mínima do aplicativo", value: text(config.general.appMinimumVersion) },
      ],
    },
    {
      title: "Vendas",
      rows: [
        { key: "sales.orderTopCode", label: "TOP padrão do pedido", value: text(config.sales.orderTopCode) },
        { key: "sales.eligibleOrderTopCodes", label: "TOPs de pedido permitidas", value: codes(config.sales.eligibleOrderTopCodes) },
        { key: "sales.topAllowlist", label: "Lista de TOPs autorizadas", value: codes(config.sales.topAllowlist) },
        { key: "sales.quotationTopCode", label: "TOP de orçamento", value: text(config.sales.quotationTopCode) },
        { key: "sales.quoteTopCodes", label: "TOPs de orçamento", value: codes(config.sales.quoteTopCodes) },
        { key: "sales.skipConfirmationTopCodes", label: "TOPs sem confirmação", value: codes(config.sales.skipConfirmationTopCodes) },
        { key: "sales.defaultNegotiationTypeCode", label: "Negociação padrão", value: text(config.sales.defaultNegotiationTypeCode) },
        { key: "sales.negotiationTypes", label: "Tipos de negociação vendáveis", value: codes(config.sales.negotiationTypes.map((type) => type.code)) },
        { key: "sales.negotiationTypeExclusions", label: "Negociações excluídas", value: codes(config.sales.negotiationTypeExclusions) },
        { key: "sales.orderStockLocationCode", label: "Local de estoque do pedido", value: text(config.sales.orderStockLocationCode) },
        { key: "sales.orderBehavior.decimalQuantities", label: "Quantidades decimais", value: yesNo(config.sales.orderBehavior.decimalQuantities) },
        { key: "sales.orderBehavior.allowDraftWithoutPrice", label: "Rascunho sem preço", value: yesNo(config.sales.orderBehavior.allowDraftWithoutPrice) },
        { key: "sales.discountAuthorityMode", label: "Liberação de desconto", value: config.sales.discountAuthorityMode === "erp" ? "Sankhya libera" : "Aprovação no Force" },
      ],
    },
    {
      title: "Clientes",
      rows: [
        { key: "customers.historyDays", label: "Dias de histórico de vendas", value: text(config.customers.historyDays) },
        { key: "customers.purchasedWindowDays", label: "Janela de produtos comprados (dias)", value: text(config.customers.purchasedWindowDays) },
        { key: "customers.creditFeatures.showCreditLimit", label: "Exibe limite de crédito", value: yesNo(config.customers.creditFeatures.showCreditLimit) },
        { key: "customers.customerWithoutPriceTable", label: "Cliente sem tabela de preço", value: config.customers.customerWithoutPriceTable },
      ],
    },
    {
      title: "Produtos",
      rows: [
        { key: "products.sellableUsageValues", label: "Usos vendáveis", value: config.products.sellableUsageValues.join(", ") || NONE },
        { key: "products.showInactive", label: "Mostra inativos", value: yesNo(config.products.showInactive) },
      ],
    },
    {
      title: "Preços",
      rows: [
        { key: "pricing.mobilePriceTableCodes", label: "Tabelas de preço do aplicativo", value: codes(config.pricing.mobilePriceTableCodes) },
        { key: "pricing.catalogReferenceTableCode", label: "Tabela de referência do catálogo", value: text(config.pricing.catalogReferenceTableCode) },
        { key: "pricing.fallbackTableCode", label: "Tabela alternativa (fallback)", value: text(config.pricing.fallbackTableCode) },
        { key: "pricing.fallbackStrategy", label: "Estratégia sem preço", value: fallbackStrategyLabels[config.pricing.fallbackStrategy] ?? config.pricing.fallbackStrategy },
        { key: "pricing.alternativeTable.tableCode", label: "Tabela alternativa registrada (inativa)", value: text(alternative?.tableCode) },
      ],
    },
    {
      title: "Financeiro",
      rows: [
        { key: "financial.showFinancialArea", label: "Área financeira", value: yesNo(config.financial.showFinancialArea) },
        { key: "financial.overdueTitles", label: "Títulos vencidos", value: yesNo(config.financial.overdueTitles) },
        { key: "financial.creditChecks", label: "Verificação de crédito", value: yesNo(config.financial.creditChecks) },
      ],
    },
    {
      title: "Sankhya",
      rows: [
        {
          key: "erp.orderStatusDisplay",
          label: "Situações do pedido (nome e cor)",
          value: config.erp?.orderStatusDisplay?.map((status) => `${status.code} ${status.label}`).join("; ") || NONE,
        },
        {
          key: "erp.liberationEventLabels",
          label: "Eventos de liberação",
          value: Object.entries(config.erp?.liberationEventLabels ?? {}).map(([code, label]) => `${code} ${label}`).join("; ") || NONE,
        },
      ],
    },
  ];
}

/** Where a value comes from: `TABLE.COLUMN` read from Sankhya, or the base file. */
export function originOf(provenance: Provenance | undefined, key: string): string {
  const entry = provenance?.[key];
  if (entry === undefined) return "arquivo base";
  if ("source" in entry) return "arquivo base";
  return `Sankhya: ${entry.table}.${entry.column}`;
}

const syncLabels: Record<ApiSchema<"SyncStatus">, { label: string; tone: Tone }> = {
  idle: { label: "Aguardando", tone: "neutral" },
  running: { label: "Em execução", tone: "info" },
  succeeded: { label: "Concluída", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
};

/** Read-only settings (W-38): the commercial values are edited in Sankhya, never here. */
export function SettingsPage() {
  const api = useApi();
  const query = useQuery(configurationQueryOptions(api));
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Valores em uso nesta instalação e de onde cada um vem (somente leitura)."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />}
            loading={query.isFetching}
            loadingText="Atualizando…"
            onClick={() => void query.refetch()}
          >
            Atualizar
          </Button>
        }
      />
      {query.isPending ? (
        <LoadingPanel title="Carregando as configurações…" description="Buscando a configuração em uso." lines={8} />
      ) : query.isError ? (
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar as configurações" />
        </Card>
      ) : (
        <SettingsView data={query.data} />
      )}
    </>
  );
}

function SettingsView({ data }: { data: ApiSchema<"ConfigurationResponse"> }) {
  const { configuration: config } = data;
  const sync = data.syncStates.find((state) => state.entity === "configuration");
  const fromSankhya = config.source.kind === "sankhya";
  const status = sync === undefined ? { label: "Desligada", tone: "neutral" as Tone } : syncLabels[sync.status];
  return (
    <>
      <Alert tone="info" title="Edite no Sankhya">
        Edite no Sankhya; o Force lê a cada 15 min. Nada nesta tela é editável.
      </Alert>
      <Card>
        <CardHeader title="Última sincronização da configuração" actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} />
        <CardBody>
          {sync === undefined ? (
            <p>A leitura da configuração do Sankhya está desligada; os valores vêm do arquivo base.</p>
          ) : (
            <p>
              Última com sucesso: <DateText value={sync.lastSuccessAt} withTime fallback="nunca" />. Última tentativa:{" "}
              <DateText value={sync.lastAttemptAt} withTime fallback="—" />.
              {sync.status === "failed" ? <> Motivo: {sync.lastErrorMessage ?? sync.lastErrorClass ?? "não informado"}.</> : null}
            </p>
          )}
          <p className="text-fg-muted">
            Versão {config.source.version} ({fromSankhya ? "lida do Sankhya" : "arquivo base"}), de <DateText value={config.source.syncedAt} withTime />.
          </p>
          <p className="text-fg-muted">
            Leituras só informativas (produtos por mobilidade, uso do financeiro, ocultar limite de crédito, parâmetros sem funcionalidade) ficam no relatório da sincronização, nos logs do worker.
          </p>
        </CardBody>
      </Card>
      {settingGroups(config).map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} />
          <Table label={group.title}>
            <TableCaption>{group.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Lido em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => {
                const entry = config.provenance?.[row.key];
                return (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell wrap>{row.value}</TableCell>
                    <TableCell>{originOf(config.provenance, row.key)}</TableCell>
                    <TableCell>{entry !== undefined && "readAt" in entry ? <DateText value={entry.readAt} withTime /> : NONE}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ))}
    </>
  );
}
