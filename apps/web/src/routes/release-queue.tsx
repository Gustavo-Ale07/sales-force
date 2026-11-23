import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Button,
  Card,
  DateText,
  EmptyState,
  FilterBar,
  FilterField,
  IconButton,
  Money,
  PageHeader,
  Pagination,
  SegmentedControl,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableLoadingRows,
  TableMessageRow,
  TableRow,
  formatDateTime,
  titleCase,
  toast,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRefreshStage } from "../components/order-stage";
import { QueryError } from "../components/query-error";
import { releaseQueueCountQueryOptions, releaseQueueQueryOptions, sellersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { formatCount } from "../lib/labels";
import { formatWaiting } from "../lib/release-queue";
import type { ReleaseQueueSearch } from "../lib/route-search";
import { asInt, compact } from "../lib/search-params";

type Item = ApiSchema<"ReleaseQueueItem">;

const COLUMNS = 9;
const ALL = "__all";
const TZ = "America/Sao_Paulo";

export interface ReleaseQueuePageProps {
  params: ReleaseQueueSearch;
  onSearchChange: (next: ReleaseQueueSearch) => void;
}

/** Small copy button: the note number is what the person searches in the Sankhya release screen. */
function CopyNunota({ nunota }: { nunota: number }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(nunota));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: "Não foi possível copiar", description: `Selecione o número ${nunota} e copie manualmente.`, tone: "danger" });
    }
  };
  return (
    <>
      <IconButton
        size="sm"
        label={`Copiar número do pedido ${nunota}`}
        icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        onClick={() => void copy()}
      />
      <span role="status" className="sr-only">
        {copied ? "Número copiado" : ""}
      </span>
    </>
  );
}

/** "Aguardando liberação": who must release which Sankhya order. Read only; the release itself is done in Sankhya. */
export function ReleaseQueuePage({ params, onSearchChange }: ReleaseQueuePageProps) {
  const api = useApi();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const query = useQuery(releaseQueueQueryOptions(api, { page, pageSize, sector: params.sector, sellerCode: params.sellerCode }));
  const counts = useQuery(releaseQueueCountQueryOptions(api));
  const sellers = useQuery(sellersQueryOptions(api));
  const { refresh, running, failed } = useRefreshStage();

  const change = (patch: Partial<ReleaseQueueSearch>) => onSearchChange(compact({ ...params, page: undefined, ...patch }));
  const sectors = counts.data?.sectors ?? [];
  const sellerOptions = sellers.data?.items ?? [];
  const withSellers = sellerOptions.length > 1;
  const checkedAt = counts.data?.lastCheckedAt ?? null;
  const activeCount = (params.sellerCode !== undefined ? 1 : 0) + (params.sector !== undefined ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Aguardando liberação"
        count={query.data ? formatCount(query.data.total) : undefined}
        badges={<StatusBadge tone="neutral">Liberação no Sankhya</StatusBadge>}
        actions={
          <>
            {checkedAt ? (
              <span className="text-sm text-fg-muted" data-testid="release-queue-checked-at">
                {`atualizado em ${formatDateTime(checkedAt, { timeZone: TZ })}`}
              </span>
            ) : null}
            <Button
              variant="secondary"
              loading={running}
              disabled={running}
              leftIcon={<RefreshCw size={15} aria-hidden="true" />}
              onClick={refresh}
            >
              {running ? "Atualizando…" : "Atualizar agora"}
            </Button>
          </>
        }
      />
      {failed ? (
        <p role="alert" className="m-0 text-sm text-danger">
          Não foi possível iniciar a atualização. Tente de novo.
        </p>
      ) : null}

      {sectors.length > 1 ? (
        <SegmentedControl
          aria-label="Setor"
          className="sm:w-auto"
          value={params.sector ?? ALL}
          onValueChange={(value) => change({ sector: value === ALL ? undefined : value })}
          options={[
            { value: ALL, label: `Todos (${formatCount(counts.data?.total ?? 0)})` },
            ...sectors.map((s) => ({ value: s.sector, label: `${s.sector} (${formatCount(s.count)})` })),
          ]}
        />
      ) : null}

      {withSellers ? (
        <FilterBar activeCount={activeCount}>
          <FilterField label="Vendedor" className="sm:w-72">
            <Select value={params.sellerCode ?? ""} onChange={(e) => change({ sellerCode: asInt(e.target.value, 0) })}>
              <option value="">Todos</option>
              {sellerOptions.map((seller) => (
                <option key={seller.code} value={seller.code}>
                  {seller.name}
                </option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>
      ) : null}

      <Card>
        <Table label="Pedidos aguardando liberação" cards>
          <TableCaption>Pedidos aguardando liberação no Sankhya, os mais antigos primeiro</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Nº do pedido</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead numeric>Valor</TableHead>
              <TableHead>TOP</TableHead>
              <TableHead>Pedido feito em</TableHead>
              <TableHead>Aguardando há</TableHead>
              <TableHead>Responsável</TableHead>
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
                <EmptyState compact title="Nenhum pedido aguardando liberação" />
              </TableMessageRow>
            ) : (
              query.data.items.map((item: Item) => (
                <TableRow key={`${item.nunota}-${item.sector}-${item.event}-${item.cascadeSequence ?? 0}`}>
                  <TableCell card="title">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-base font-semibold tabular-nums">{item.nunota}</span>
                      <CopyNunota nunota={item.nunota} />
                    </span>
                  </TableCell>
                  <TableCell label="Setor">{item.sector}</TableCell>
                  <TableCell wrap label="Cliente" className="min-w-[10rem]">
                    {titleCase(item.customerName)}
                  </TableCell>
                  <TableCell label="Vendedor">{item.sellerName ? titleCase(item.sellerName) : "—"}</TableCell>
                  <TableCell numeric label="Valor">
                    <Money value={item.estimatedTotal} />
                  </TableCell>
                  <TableCell label="TOP">{item.topCode ?? "—"}</TableCell>
                  <TableCell label="Pedido feito em">
                    <DateText value={item.orderedAt} withTime timeZone={TZ} />
                  </TableCell>
                  <TableCell label="Aguardando há" className="font-medium">
                    {formatWaiting(item.waitingMinutes)}
                  </TableCell>
                  <TableCell label="Responsável">{item.assignedUserCode ?? "—"}</TableCell>
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
            onPageChange={(next) => onSearchChange(compact({ ...params, page: next > 1 ? next : undefined }))}
            onPageSizeChange={(size) => change({ pageSize: size !== 25 ? size : undefined })}
          />
        ) : null}
      </Card>
    </>
  );
}
