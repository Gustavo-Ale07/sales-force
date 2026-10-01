import {
  acknowledgePriceReview,
  discardLocalDraft,
  getDraft,
  getDraftItems,
  listOperationalDrafts,
  readExpectedDataset,
  resolveConflict,
  saveOrderDraft,
  type ConflictResolution,
  type DraftItemInput,
  type DraftItemRecord,
  type DraftRecord,
  type DraftStatus,
  type OfflineEnv,
  type OrderTransport,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import { discountTextOf, parseDiscountInput, parseQuantityInput, type EditorLine } from "../data/order-draft";
import type { ListPriceContext, Page } from "../data/ports";
import { listSales, summarizeSales, type SalesFilters, type SalesRow, type SalesSummary } from "./sales";

export interface SaveLocalDraftInput {
  /** `null` = a new draft. */
  readonly localId: string | null;
  readonly customer: { readonly code: number; readonly name: string };
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly lines: readonly EditorLine[];
}

export interface OpenedLocalDraft {
  readonly draft: DraftRecord;
  readonly lines: EditorLine[];
}

/** What the screens use to work with drafts that live on this device. */
export interface LocalOrdersPort {
  save(input: SaveLocalDraftInput): Promise<DraftRecord>;
  list(): Promise<DraftRecord[]>;
  /** One page of the sales list (Central de Vendas): filtered, counted and paged in SQLite. */
  listSales(filters: SalesFilters, request: { search: string; page: number; pageSize: number }): Promise<Page<SalesRow>>;
  /** Counters and value of the same filters, for the summary above the list. */
  summarizeSales(filters: SalesFilters, search: string): Promise<SalesSummary>;
  /** One draft with its stored state, or `null` (used by the sale detail). */
  get(localId: string): Promise<DraftRecord | null>;
  open(localId: string): Promise<OpenedLocalDraft | null>;
  discard(localId: string): Promise<void>;
  acknowledgePriceReview(localId: string): Promise<void>;
  resolveConflict(localId: string, resolution: ConflictResolution): Promise<void>;
}

/** The editor keeps its own line model; only validated quantity/discount and the price snapshot are stored. */
export function toDraftItems(lines: readonly EditorLine[]): DraftItemInput[] {
  return lines.map((line) => {
    const quantity = parseQuantityInput(line.quantityText);
    if (!quantity.ok) throw new Error("Quantidade inválida em uma das linhas.");
    const discount = parseDiscountInput(line.discountText);
    if (!discount.ok) throw new Error("Desconto inválido em uma das linhas.");
    return {
      productCode: line.productCode,
      description: line.description,
      unit: line.unit,
      quantity: quantity.value,
      // A missing price has nothing to discount (P-09).
      discountPercent: line.price.state === "none" ? "0" : discount.value,
      priceJson: JSON.stringify(line.price),
      groupCode: line.group?.code ?? null,
      groupName: line.group?.name ?? null,
    };
  });
}

function parsePrice(json: string): ListPriceContext {
  try {
    const parsed = JSON.parse(json) as ListPriceContext;
    if (parsed.state === "none" || ((parsed.state === "priced" || parsed.state === "zero") && typeof parsed.unitPrice === "string")) return parsed;
  } catch {
    // fall through: unreadable price data is "no price", never a fabricated value
  }
  return { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" };
}

export function linesFromDraftItems(items: readonly DraftItemRecord[]): EditorLine[] {
  return items.map((item) => ({
    key: `local-${item.position}`,
    productCode: item.productCode,
    description: item.description,
    unit: item.unit,
    quantityText: item.quantity.replace(".", ","),
    discountText: discountTextOf(item.discountPercent),
    price: parsePrice(item.priceJson),
    group: { code: item.groupCode, name: item.groupName },
  }));
}

export function createLocalOrdersPort(deps: {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly transport: OrderTransport;
  readonly ownerAccountId: string;
  /** Called after any change so counters and the indicator update, and a sync can start when online. */
  readonly onChanged: () => void;
}): LocalOrdersPort {
  const { db, env, transport, ownerAccountId, onChanged } = deps;
  return {
    async save(input) {
      const id = await saveOrderDraft(db, env, {
        ownerAccountId,
        ...(input.localId === null ? {} : { localId: input.localId }),
        customerCode: input.customer.code,
        customerName: input.customer.name,
        negotiationTypeCode: input.negotiationTypeCode,
        notes: input.notes,
        items: toDraftItems(input.lines),
      });
      const draft = await getDraft(db, id);
      onChanged();
      if (draft === null) throw new Error("Rascunho não encontrado após salvar.");
      return draft;
    },
    // Only normal work for the confirmed dataset: legacy / other-dataset orders are not resumable orders (they surface as attention items).
    list: async () => listOperationalDrafts(db, ownerAccountId, await readExpectedDataset(db)),
    listSales: async (filters, request) => listSales(db, ownerAccountId, filters, request, env.now(), await readExpectedDataset(db)),
    summarizeSales: async (filters, search) => summarizeSales(db, ownerAccountId, filters, search, env.now(), await readExpectedDataset(db)),
    async get(localId) {
      const draft = await getDraft(db, localId);
      return draft !== null && draft.ownerAccountId === ownerAccountId ? draft : null;
    },
    async open(localId) {
      const draft = await getDraft(db, localId);
      if (draft === null || draft.ownerAccountId !== ownerAccountId) return null;
      return { draft, lines: linesFromDraftItems(await getDraftItems(db, localId)) };
    },
    async discard(localId) {
      await discardLocalDraft(db, ownerAccountId, localId);
      onChanged();
    },
    async acknowledgePriceReview(localId) {
      await acknowledgePriceReview(db, env, localId);
      onChanged();
    },
    async resolveConflict(localId, resolution) {
      await resolveConflict(db, env, transport, localId, resolution);
      onChanged();
    },
  };
}

/** Seller-facing text for a draft's sync state (never a technical error). */
export function describeDraftStatus(status: DraftStatus): string {
  switch (status) {
    case "local_only":
      return "Somente neste aparelho";
    case "pending_sync":
      return "Aguardando envio";
    case "syncing":
      return "Enviando...";
    case "synced":
      return "Sincronizado";
    case "sync_error":
      return "Erro ao sincronizar";
    case "conflict":
      return "Conflito: escolha a versão";
    case "needs_review":
      return "Revisar preços";
  }
}
