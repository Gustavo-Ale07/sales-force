import { useEffect, useMemo, useRef, useState } from "react";
import { DatasetChangedError, DatasetUnavailableError, type DraftRecord } from "@salesforce/mobile-db";
import { datasetIdentityOf } from "../offline/reference-source";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiRequestError } from "../data/api";
import { describeDataError, type DataErrorInfo } from "../data/errors";
import {
  decrementLineQuantity,
  incrementLineQuantity,
  isLinePriceOrderable,
  lineFromOrderItem,
  lineFromProduct,
  previewDraft,
  toRequestItems,
  describeIssue,
  type EditorLine,
} from "../data/order-draft";
import type { CustomerListItem, OrderDetail, OrderEntryConfiguration, OrderRepository, ProductListItem, Repositories } from "../data/ports";
import { formatBrl } from "../lib/money";
import { describeDraftStatus, type LocalOrdersPort } from "../offline/local-orders";
import { newClientRequestId } from "../lib/uuid";
import { colors, spacing } from "../theme";
import { CartView } from "./cart-view";
import { CustomerPicker } from "./customer-picker";
import { DiscountSheet } from "./discount-sheet";
import { GroupDiscountSheet } from "./group-discount-sheet";
import { ProductPicker } from "./product-picker";
import type { ProductOrderActions } from "./product-views";

type Step = "customer" | "products" | "cart";

/** Enough of a customer to display and to send as `customerCode`; a saved/reopened draft never carries the full catalog row. */
type PickedCustomer = Pick<CustomerListItem, "code" | "name">;

interface SaveFailure {
  readonly title: string;
  readonly messages: readonly string[];
  readonly correlationId?: string;
  /** `version_conflict` / `order_not_editable`: another save happened elsewhere — offer to reload, never silently overwrite it. */
  readonly reloadable: boolean;
}

/** Turns a failed save into user-facing text. Per-item issues are listed; the server stays authoritative. Mirrors `apps/web`'s `describeSaveFailure`. */
function describeSaveFailure(error: unknown): SaveFailure {
  if (error instanceof ApiRequestError) {
    if (error.code === "version_conflict") {
      return {
        title: "O rascunho foi alterado em outro lugar",
        messages: ["Recarregue para ver a versão atual. Suas alterações não salvas serão descartadas."],
        correlationId: error.correlationId,
        reloadable: true,
      };
    }
    if (error.code === "order_not_editable") {
      return {
        title: "Este pedido não pode mais ser editado",
        messages: ["Ele já não é um rascunho. Recarregue para ver a situação atual."],
        correlationId: error.correlationId,
        reloadable: true,
      };
    }
    if (error.code === "idempotency_conflict") {
      return {
        title: "Não foi possível salvar",
        messages: ["Esta solicitação já foi registrada com outros dados. Tente salvar novamente."],
        correlationId: error.correlationId,
        reloadable: false,
      };
    }
    if (error.issues.length > 0) {
      return {
        title: "Corrija os itens antes de salvar",
        messages: error.issues.map(describeIssue),
        correlationId: error.correlationId,
        reloadable: false,
      };
    }
  }
  const info: DataErrorInfo = describeDataError(error);
  return { title: "Não foi possível salvar o rascunho", messages: [info.message], correlationId: info.correlationId, reloadable: false };
}

export interface NewOrderScreenProps {
  readonly repositories: Pick<Repositories, "customers" | "products" | "orders">;
  readonly onUnauthenticated: () => void;
  /**
   * When present, "Salvar" writes the draft to this device (encrypted DB + outbox) and the sync manager delivers it,
   * online or not. Without it the screen keeps its online-only behavior (POST/PUT straight to the API).
   */
  readonly localOrders?: LocalOrdersPort;
  /** A local draft chosen in the "Pedidos" tab; loaded once, then `onResumeConsumed` clears it. */
  readonly resumeLocalId?: string | null;
  readonly onResumeConsumed?: () => void;
  /** "Novo pedido" from a customer sheet: start (or continue) an order for this customer. Handled once per `nonce`. */
  /** With `lines` (a duplicated sale) the cart opens pre-filled as a brand-new order; an order in progress is never replaced silently. */
  readonly startRequest?: { readonly nonce: number; readonly customer: PickedCustomer; readonly lines?: readonly EditorLine[] } | null;
  readonly onStartConsumed?: () => void;
}

/**
 * Online-only new-order flow (MOB-4): pick the customer, browse the catalog, edit the cart and save the draft
 * through the same `POST /orders` / `PUT /orders/{id}` the web editor uses. There is no local outbox here
 * (MOB-2/V-09 pending) — a save always needs the server, and every price/total shown is an estimate from
 * `packages/domain`, the server response on save being authoritative (P-09). Negotiation type, notes and bulk
 * entry are out of this slice; reopening an existing draft is only reachable from this screen's own success
 * step (there is no order-list screen yet — see the mobile-engineer report).
 */
export function NewOrderScreen({
  repositories,
  onUnauthenticated,
  localOrders,
  resumeLocalId = null,
  onResumeConsumed,
  startRequest = null,
  onStartConsumed,
}: NewOrderScreenProps) {
  const [step, setStep] = useState<Step>("customer");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<readonly EditorLine[]>([]);
  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;
  // One idempotency key per distinct payload: a retry after a lost response resends the same key, an edited payload gets a new one.
  // Only `create` uses this: `replace` is optimistic-concurrency based (`expectedVersion`), not idempotency-key based (mirrors web).
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  /** `null` while creating a fresh draft; the loaded order (its id, version, negotiation type and notes) while editing one. */
  const [editingOrder, setEditingOrder] = useState<OrderDetail | null>(null);
  /** Phone-appropriate stand-in for the desktop's checkboxes + toolbar (DISC-1/MOB-4): long-press or this toggle. */
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [massDiscountOpen, setMassDiscountOpen] = useState(false);
  /** Manual ad-hoc subset apply (not "group discount" — MOB-4a superseded that label; see `GroupDiscountSheet` below for the real catalog-group feature). */
  const [selectedDiscountOpen, setSelectedDiscountOpen] = useState(false);
  /** Automatic catalog-group discount (MOB-4a): buckets the cart by product `groupCode`/`groupName`. */
  const [groupDiscountOpen, setGroupDiscountOpen] = useState(false);

  const [config, setConfig] = useState<
    { status: "loading" } | { status: "error"; error: DataErrorInfo } | { status: "ready"; value: OrderEntryConfiguration }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [savedOrder, setSavedOrder] = useState<OrderDetail | null>(null);
  /** The device-local draft being edited (offline-first path); `null` for a fresh order. */
  const [localDraft, setLocalDraft] = useState<DraftRecord | null>(null);
  const [savedLocal, setSavedLocal] = useState<DraftRecord | null>(null);

  // Latest cart state for the start-request handler, which must react only to a new request, not to every edit.
  const finished = savedLocal !== null || savedOrder !== null;
  const inProgress = useRef({ customer, lines, finished });
  useEffect(() => {
    inProgress.current = { customer, lines, finished };
  });
  const startNonce = startRequest?.nonce ?? null;
  const startCustomer = startRequest?.customer ?? null;
  const startLines = startRequest?.lines;
  useEffect(() => {
    if (startNonce === null || startCustomer === null) return;
    onStartConsumed?.();
    const current = inProgress.current;
    const begin = () => {
      resetOrder();
      setCustomer(startCustomer);
      if (startLines === undefined) {
        setStep("products");
        return;
      }
      setLines(startLines.map((line) => ({ ...line, key: nextKey() })));
      setStep("cart");
    };
    // Nothing at risk: an empty cart, or an order already saved (its success screen is showing).
    if (current.lines.length === 0 || current.finished) {
      begin();
      return;
    }
    if (startLines === undefined && current.customer?.code === startCustomer.code) {
      setStep("products");
      return;
    }
    // An order with items is in progress for another customer: never replace it silently.
    Alert.alert(
      "Você já possui um pedido em andamento",
      `Pedido de ${current.customer?.name ?? "outro cliente"} com ${current.lines.length} ${current.lines.length === 1 ? "item" : "itens"}. Iniciar um novo pedido descarta os itens que ainda não foram salvos.`,
      [
        { text: "Continuar pedido atual", onPress: () => setStep("cart") },
        { text: "Iniciar novo pedido", style: "destructive", onPress: begin },
        { text: "Cancelar", style: "cancel" },
      ],
    );
    // Only a new request (nonce) triggers this; the handlers above read the latest state through refs/closures of this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

  useEffect(() => {
    if (resumeLocalId === null || localOrders === undefined) return undefined;
    let active = true;
    localOrders
      .open(resumeLocalId)
      .then((opened) => {
        if (!active) return;
        onResumeConsumed?.();
        if (opened === null) return;
        setLocalDraft(opened.draft);
        setCustomer({ code: opened.draft.customerCode, name: opened.draft.customerName });
        setLines(opened.lines);
        setSavedLocal(null);
        setSaveFailure(null);
        setStep("cart");
      })
      .catch(() => {
        if (!active) return;
        onResumeConsumed?.();
        setSaveFailure({ title: "Não foi possível abrir o pedido", messages: ["Tente novamente."], reloadable: false });
      });
    return () => {
      active = false;
    };
  }, [resumeLocalId, localOrders, onResumeConsumed]);

  useEffect(() => {
    let active = true;
    void loadConfiguration(repositories.orders);
    return () => {
      active = false;
    };

    async function loadConfiguration(orders: OrderRepository) {
      try {
        const value = await orders.getEntryConfiguration();
        if (active) setConfig({ status: "ready", value });
      } catch (error) {
        if (!active) return;
        const info = describeDataError(error);
        if (info.kind === "unauthenticated") {
          onUnauthenticated();
          return;
        }
        setConfig({ status: "error", error: info });
      }
    }
  }, [repositories.orders, onUnauthenticated]);

  const preview = useMemo(() => previewDraft(lines), [lines]);
  const productActions = useMemo<ProductOrderActions>(() => {
    const quantities = new Map(lines.map((line) => [line.productCode, line.quantityText]));
    return { quantityOf: (code) => quantities.get(code), onAdd: addProduct, onDecrement: decrementProduct };
    // addProduct/decrementProduct only use functional state updates, so they are safe to capture per `lines` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  const blockedLineCount = useMemo(() => {
    if (config.status !== "ready") return 0;
    return preview.lines.filter((linePreview, index) => {
      const state = lines[index]?.price.state;
      return state !== undefined && state === "none" && !isLinePriceOrderable(state, config.value);
    }).length;
  }, [config, preview.lines, lines]);

  function resetOrder() {
    requestIdRef.current = null;
    setCustomer(null);
    setLines([]);
    setSavedOrder(null);
    setSavedLocal(null);
    setLocalDraft(null);
    setSaveFailure(null);
    setEditingOrder(null);
    setSelectionMode(false);
    setSelected(new Set());
    setStep("customer");
  }

  /** Reopens the just-saved draft for editing (the only entry point this slice has — there is no order-list screen yet). */
  function editSavedOrder(order: OrderDetail) {
    setEditingOrder(order);
    setCustomer({ code: order.customerCode, name: order.customerName });
    setLines(order.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    setSavedOrder(null);
    setSaveFailure(null);
    setSelectionMode(false);
    setSelected(new Set());
    setStep("cart");
  }

  /** Discards local edits and reloads the authoritative order after a `version_conflict` / `order_not_editable`. */
  async function reload() {
    if (editingOrder === null) return;
    try {
      const fresh = await repositories.orders.get(editingOrder.id);
      setEditingOrder(fresh);
      setCustomer({ code: fresh.customerCode, name: fresh.customerName });
      setLines(fresh.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
      setSaveFailure(null);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setSaveFailure(describeSaveFailure(error));
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelected(new Set());
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  function toggleSelect(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Long-pressing a line enters selection mode and selects it in one gesture. */
  function enterSelectionWith(key: string) {
    setSelectionMode(true);
    setSelected(new Set([key]));
  }

  function changeCustomer() {
    if (lines.length === 0) {
      setCustomer(null);
      setStep("customer");
      return;
    }
    Alert.alert("Trocar cliente", "O carrinho atual será esvaziado. Deseja continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Continuar",
        style: "destructive",
        onPress: () => {
          setLines([]);
          setCustomer(null);
          setStep("customer");
        },
      },
    ]);
  }

  function addProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (existing) return current.map((line) => (line.key === existing.key ? incrementLineQuantity(line) : line));
      return [...current, lineFromProduct(product, nextKey())];
    });
  }

  function decrementProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (!existing) return current;
      const step = decrementLineQuantity(existing);
      if (step === null) return current;
      if (step.kind === "remove") return current.filter((line) => line.key !== existing.key);
      return current.map((line) => (line.key === existing.key ? { ...line, quantityText: step.quantityText } : line));
    });
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
    setSelected((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function setQuantityText(key: string, text: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, quantityText: text } : line)));
  }

  function setDiscountText(key: string, text: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, discountText: text } : line)));
  }

  async function save() {
    if (customer === null || saving) return;
    setSaving(true);
    setSaveFailure(null);
    if (localOrders !== undefined) {
      try {
        const saved = await localOrders.save({
          localId: localDraft?.localId ?? null,
          customer,
          negotiationTypeCode:
            localDraft !== null
              ? localDraft.negotiationTypeCode
              : config.status === "ready"
                ? config.value.sales.defaultNegotiationTypeCode
                : null,
          notes: localDraft?.notes ?? null,
          lines,
          loadedDataset: config.status === "ready" ? datasetIdentityOf(config.value) : null,
        });
        setLocalDraft(saved);
        setSavedLocal(saved);
      } catch (error) {
        setSaveFailure({
          title: "Não foi possível salvar o pedido neste aparelho",
          messages: [
            error instanceof DatasetUnavailableError || error instanceof DatasetChangedError
              ? error.message
              : "Este pedido não pode mais ser alterado aqui. Abra-o em Pedidos para ver a situação.",
          ],
          reloadable: false,
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const body = {
        customerCode: customer.code,
        // Editing an existing draft keeps its negotiation type and notes as loaded (not editable in this slice);
        // a fresh draft uses the installation default.
        negotiationTypeCode:
          editingOrder !== null
            ? editingOrder.negotiationTypeCode
            : config.status === "ready"
              ? config.value.sales.defaultNegotiationTypeCode
              : null,
        notes: editingOrder !== null ? editingOrder.notes : null,
        items: toRequestItems(lines),
      };
      if (editingOrder !== null) {
        const updated = await repositories.orders.replace(editingOrder.id, { expectedVersion: editingOrder.version, ...body });
        setEditingOrder(updated);
        setSavedOrder(updated);
      } else {
        const payload = JSON.stringify(body);
        if (requestIdRef.current?.payload !== payload) {
          requestIdRef.current = { payload, id: newClientRequestId() };
        }
        const created = await repositories.orders.create({ clientRequestId: requestIdRef.current.id, ...body });
        setSavedOrder(created);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setSaveFailure(describeSaveFailure(error));
    } finally {
      setSaving(false);
    }
  }

  if (savedLocal !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>Pedido salvo neste aparelho</Text>
        <Text style={styles.successMeta}>{savedLocal.customerName}</Text>
        <Text style={styles.successMeta}>{describeDraftStatus(savedLocal.status)}</Text>
        <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
          <Text style={styles.primaryButtonText}>Novo pedido</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setSavedLocal(null)} accessibilityRole="button" accessibilityLabel="Editar pedido">
          <Text style={styles.secondaryButtonText}>Editar pedido</Text>
        </Pressable>
      </View>
    );
  }

  if (savedOrder !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>{editingOrder !== null ? "Alterações salvas" : "Rascunho salvo"}</Text>
        <Text style={styles.successMeta}>{`Pedido nº ${savedOrder.draftNumber} · ${savedOrder.customerName}`}</Text>
        <Text style={styles.successTotal}>{formatBrl(savedOrder.estimatedTotal) ?? "—"}</Text>
        {savedOrder.isPartial && <Text style={styles.partialNotice}>Total parcial: há itens sem preço neste rascunho.</Text>}
        <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
          <Text style={styles.primaryButtonText}>Novo pedido</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => editSavedOrder(savedOrder)}
          accessibilityRole="button"
          accessibilityLabel="Editar pedido"
        >
          <Text style={styles.secondaryButtonText}>Editar pedido</Text>
        </Pressable>
      </View>
    );
  }

  if (step === "customer") {
    return (
      <View style={styles.flex}>
        <Text style={styles.stepTitle}>Selecione o cliente</Text>
        <CustomerPicker
          customers={repositories.customers}
          onSelect={(picked) => {
            setCustomer(picked);
            setStep("products");
          }}
          onUnauthenticated={onUnauthenticated}
        />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.customerBar}>
        <View style={styles.customerInfo}>
          <Text style={styles.customerCaption}>Cliente</Text>
          <Text style={styles.customerName} numberOfLines={1}>
            {customer?.name}
          </Text>
        </View>
        {editingOrder === null && (
          <Pressable onPress={changeCustomer} accessibilityRole="button" accessibilityLabel="Trocar cliente">
            <Text style={styles.changeCustomer}>Trocar</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.pills} accessibilityRole="tablist">
        <Pressable
          style={[styles.pill, step === "products" && styles.pillActive]}
          onPress={() => setStep("products")}
          accessibilityRole="tab"
          accessibilityState={{ selected: step === "products" }}
        >
          <Text style={[styles.pillText, step === "products" && styles.pillTextActive]}>Produtos</Text>
        </Pressable>
        <Pressable
          style={[styles.pill, step === "cart" && styles.pillActive]}
          onPress={() => setStep("cart")}
          accessibilityRole="tab"
          accessibilityState={{ selected: step === "cart" }}
        >
          <Text style={[styles.pillText, step === "cart" && styles.pillTextActive]}>
            {`Carrinho${lines.length > 0 ? ` (${lines.length})` : ""}`}
          </Text>
        </Pressable>
      </View>

      {/* Kept mounted (only hidden) in the cart step, so the catalog search, filters and Grade/Lista survive the round trip. */}
      <View style={step === "products" ? styles.flex : styles.hidden}>
        <ProductPicker
          products={repositories.products}
          actions={productActions}
          onUnauthenticated={onUnauthenticated}
        />
      </View>
      {step !== "products" && (
        <View style={styles.flex}>
          {lines.length > 0 && (
            <View style={styles.cartToolbar}>
              <Pressable
                style={styles.toolbarButton}
                onPress={toggleSelectionMode}
                accessibilityRole="button"
                accessibilityLabel={selectionMode ? "Cancelar seleção" : "Selecionar itens"}
              >
                <Text style={styles.toolbarButtonText}>{selectionMode ? "Cancelar seleção" : "Selecionar itens"}</Text>
              </Pressable>
              {selectionMode ? (
                <Pressable
                  style={[styles.toolbarButton, selected.size === 0 && styles.toolbarButtonDisabled]}
                  onPress={() => setSelectedDiscountOpen(true)}
                  disabled={selected.size === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Aplicar desconto aos selecionados"
                >
                  <Text style={styles.toolbarButtonText}>{`Desconto (${selected.size})`}</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    style={styles.toolbarButton}
                    onPress={() => setMassDiscountOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Desconto em massa"
                  >
                    <Text style={styles.toolbarButtonText}>Desconto em massa</Text>
                  </Pressable>
                  <Pressable
                    style={styles.toolbarButton}
                    onPress={() => setGroupDiscountOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Desconto por grupo"
                  >
                    <Text style={styles.toolbarButtonText}>Desconto por grupo</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
          <ScrollView style={styles.flex}>
            <CartView
              lines={lines}
              preview={preview}
              onQuantityChange={setQuantityText}
              onDiscountChange={setDiscountText}
              onRemove={removeLine}
              selectionMode={selectionMode}
              selected={selected}
              onToggleSelect={toggleSelect}
              onLongPressLine={enterSelectionWith}
            />
          </ScrollView>
        </View>
      )}

      <View style={styles.footer}>
        {config.status === "error" && <Text style={styles.footerNotice}>{config.error.message}</Text>}
        {blockedLineCount > 0 && (
          <Text style={styles.footerNotice}>
            {`${blockedLineCount} item(ns) sem preço não podem ser salvos nesta instalação. Remova-os ou aguarde a atualização de preços.`}
          </Text>
        )}
        {saveFailure !== null && (
          <View style={styles.failureBox} accessibilityRole="alert">
            <Text style={styles.failureTitle}>{saveFailure.title}</Text>
            {saveFailure.messages.map((message) => (
              <Text key={message} style={styles.failureMessage}>
                {message}
              </Text>
            ))}
            {saveFailure.reloadable && (
              <Pressable onPress={() => void reload()} accessibilityRole="button" accessibilityLabel="Recarregar pedido">
                <Text style={styles.reloadLink}>Recarregar</Text>
              </Pressable>
            )}
          </View>
        )}
        <Pressable
          style={[
            styles.primaryButton,
            (lines.length === 0 || !preview.valid || blockedLineCount > 0 || saving) && styles.primaryButtonDisabled,
          ]}
          onPress={() => void save()}
          disabled={lines.length === 0 || !preview.valid || blockedLineCount > 0 || saving}
          accessibilityRole="button"
          accessibilityLabel={editingOrder !== null || localDraft !== null ? "Salvar alterações" : "Salvar rascunho"}
        >
          {saving ? (
            <ActivityIndicator color={colors.onNavy} />
          ) : (
            <Text style={styles.primaryButtonText}>{editingOrder !== null || localDraft !== null ? "Salvar alterações" : "Salvar rascunho"}</Text>
          )}
        </Pressable>
      </View>

      <DiscountSheet
        visible={massDiscountOpen}
        title="Desconto em massa"
        description="Aplica um desconto percentual a todos os itens do carrinho."
        lines={lines}
        match={() => true}
        onApply={(nextLines) => {
          setLines(nextLines);
          setMassDiscountOpen(false);
        }}
        onClose={() => setMassDiscountOpen(false)}
      />
      <DiscountSheet
        visible={selectedDiscountOpen}
        title="Desconto nos itens selecionados"
        description="Aplica um desconto percentual apenas aos itens marcados abaixo."
        lines={lines}
        match={(line) => selected.has(line.key)}
        onApply={(nextLines) => {
          setLines(nextLines);
          setSelectedDiscountOpen(false);
          cancelSelection();
        }}
        onClose={() => setSelectedDiscountOpen(false)}
      />
      <GroupDiscountSheet
        visible={groupDiscountOpen}
        lines={lines}
        products={repositories.products}
        onApply={(nextLines) => {
          setLines(nextLines);
          setGroupDiscountOpen(false);
        }}
        onClose={() => setGroupDiscountOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: "none" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  stepTitle: { fontSize: 16, fontWeight: "700", color: colors.text, padding: spacing.lg, paddingBottom: 0 },
  customerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customerInfo: { flex: 1 },
  customerCaption: { fontSize: 11, color: colors.textMuted },
  customerName: { fontSize: 15, fontWeight: "700", color: colors.text },
  changeCustomer: { color: colors.navy, fontWeight: "700", fontSize: 13 },
  pills: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  pill: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.background },
  pillActive: { backgroundColor: colors.navy },
  pillText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: colors.onNavy },
  cartToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  toolbarButton: {
    flexGrow: 1,
    flexBasis: "30%",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  toolbarButtonDisabled: { opacity: 0.5 },
  toolbarButtonText: { color: colors.navy, fontWeight: "700", fontSize: 13 },
  footer: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerNotice: { fontSize: 12, color: colors.warning },
  failureBox: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.md, gap: 2 },
  failureTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  failureMessage: { fontSize: 13, color: colors.text },
  reloadLink: { color: colors.navy, fontWeight: "700", fontSize: 13, marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.navy,
    minHeight: 48,
  },
  secondaryButtonText: { color: colors.navy, fontSize: 15, fontWeight: "700" },
  successTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  successMeta: { fontSize: 14, color: colors.textMuted },
  successTotal: { fontSize: 28, fontWeight: "800", color: colors.navy },
  partialNotice: { fontSize: 13, color: colors.warning, textAlign: "center" },
});
