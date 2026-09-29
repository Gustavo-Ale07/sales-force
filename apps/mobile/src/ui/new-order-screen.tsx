import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiRequestError } from "../data/api";
import { describeDataError, type DataErrorInfo } from "../data/errors";
import {
  incrementLineQuantity,
  isLinePriceOrderable,
  lineFromProduct,
  previewDraft,
  toRequestItems,
  describeIssue,
  type EditorLine,
} from "../data/order-draft";
import type { CustomerListItem, OrderDetail, OrderEntryConfiguration, OrderRepository, ProductListItem, Repositories } from "../data/ports";
import { formatBrl } from "../lib/money";
import { newClientRequestId } from "../lib/uuid";
import { colors, spacing } from "../theme";
import { CartView } from "./cart-view";
import { CustomerPicker } from "./customer-picker";
import { ProductPicker } from "./product-picker";

type Step = "customer" | "products" | "cart";

interface SaveFailure {
  readonly title: string;
  readonly messages: readonly string[];
  readonly correlationId?: string;
}

/** Turns a failed `POST /orders` into user-facing text. Per-item issues are listed; the server stays authoritative. */
function describeSaveFailure(error: unknown): SaveFailure {
  if (error instanceof ApiRequestError) {
    if (error.code === "idempotency_conflict") {
      return {
        title: "Não foi possível salvar",
        messages: ["Esta solicitação já foi registrada com outros dados. Tente salvar novamente."],
        correlationId: error.correlationId,
      };
    }
    if (error.issues.length > 0) {
      return {
        title: "Corrija os itens antes de salvar",
        messages: error.issues.map(describeIssue),
        correlationId: error.correlationId,
      };
    }
  }
  const info: DataErrorInfo = describeDataError(error);
  return { title: "Não foi possível salvar o rascunho", messages: [info.message], correlationId: info.correlationId };
}

export interface NewOrderScreenProps {
  readonly repositories: Pick<Repositories, "customers" | "products" | "orders">;
  readonly onUnauthenticated: () => void;
}

/**
 * Online-only new-order flow (MOB-4): pick the customer, browse the catalog, edit the cart and save the draft
 * through the same `POST /orders` the web editor uses. There is no local outbox here (MOB-2/V-09 pending) — a
 * save always needs the server, and every price/total shown is an estimate from `packages/domain`, the server
 * response on save being authoritative (P-09). Negotiation type, notes, bulk entry, mass/group discount and
 * editing an existing draft are out of this slice (see the mobile-engineer report).
 */
export function NewOrderScreen({ repositories, onUnauthenticated }: NewOrderScreenProps) {
  const [step, setStep] = useState<Step>("customer");
  const [customer, setCustomer] = useState<CustomerListItem | null>(null);
  const [lines, setLines] = useState<readonly EditorLine[]>([]);
  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;
  // One idempotency key per distinct payload: a retry after a lost response resends the same key, an edited payload gets a new one.
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);

  const [config, setConfig] = useState<
    { status: "loading" } | { status: "error"; error: DataErrorInfo } | { status: "ready"; value: OrderEntryConfiguration }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [savedOrder, setSavedOrder] = useState<OrderDetail | null>(null);

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
  const cartProductCodes = useMemo(() => new Set(lines.map((line) => line.productCode)), [lines]);
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
    setSaveFailure(null);
    setStep("customer");
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

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
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
    try {
      const body = {
        customerCode: customer.code,
        negotiationTypeCode: config.status === "ready" ? config.value.sales.defaultNegotiationTypeCode : null,
        notes: null,
        items: toRequestItems(lines),
      };
      const payload = JSON.stringify(body);
      if (requestIdRef.current?.payload !== payload) {
        requestIdRef.current = { payload, id: newClientRequestId() };
      }
      const created = await repositories.orders.create({ clientRequestId: requestIdRef.current.id, ...body });
      setSavedOrder(created);
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

  if (savedOrder !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>Rascunho salvo</Text>
        <Text style={styles.successMeta}>{`Pedido nº ${savedOrder.draftNumber} · ${savedOrder.customerName}`}</Text>
        <Text style={styles.successTotal}>{formatBrl(savedOrder.estimatedTotal) ?? "—"}</Text>
        {savedOrder.isPartial && <Text style={styles.partialNotice}>Total parcial: há itens sem preço neste rascunho.</Text>}
        <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
          <Text style={styles.primaryButtonText}>Novo pedido</Text>
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
        <Text style={styles.customerName} numberOfLines={1}>
          {customer?.name}
        </Text>
        <Pressable onPress={changeCustomer} accessibilityRole="button" accessibilityLabel="Trocar cliente">
          <Text style={styles.changeCustomer}>Trocar</Text>
        </Pressable>
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

      {step === "products" ? (
        <ProductPicker
          products={repositories.products}
          cartProductCodes={cartProductCodes}
          onAdd={addProduct}
          onUnauthenticated={onUnauthenticated}
        />
      ) : (
        <ScrollView style={styles.flex}>
          <CartView
            lines={lines}
            preview={preview}
            onQuantityChange={setQuantityText}
            onDiscountChange={setDiscountText}
            onRemove={removeLine}
          />
        </ScrollView>
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
          accessibilityLabel="Salvar rascunho"
        >
          {saving ? <ActivityIndicator color={colors.onNavy} /> : <Text style={styles.primaryButtonText}>Salvar rascunho</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  customerName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  changeCustomer: { color: colors.navy, fontWeight: "700", fontSize: 13 },
  pills: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  pill: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.background },
  pillActive: { backgroundColor: colors.navy },
  pillText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: colors.onNavy },
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
  successTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  successMeta: { fontSize: 14, color: colors.textMuted },
  successTotal: { fontSize: 28, fontWeight: "800", color: colors.navy },
  partialNotice: { fontSize: 13, color: colors.warning, textAlign: "center" },
});
