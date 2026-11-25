import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerDetail, CustomerFinancial, CustomerListItem, CustomerRepository } from "../data/ports";
import { describePendingReason, hasNoSeller, isUnconfirmedCustomer, NO_SELLER_ORDER_MESSAGE, PENDING_CREDIT_NOTE, PENDING_CUSTOMER_ORDER_MESSAGE } from "../data/pending-status";
import { colors, fontSize, radius, spacing } from "../theme";
import type { LocalOrdersPort } from "../offline/local-orders";
import { EMPTY_SALES_FILTERS, type SalesRow } from "../offline/sales";
import { BackLink } from "./back-link";
import { describeCustomerStatus } from "./customers-screen";
import { SaleBadgeView, describeSaleValue } from "./sale-parts";
import { describeSaleMeta } from "./sales-screen";

/** "1234.5" -> "R$ 1.234,50" without depending on Intl (not guaranteed on every Hermes build). */
function formatMoney(decimal: string): string {
  const [integer = "0", fraction = ""] = decimal.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/** "2026-11-30" -> "30/11/2026" (a due date has no time zone). */
function formatDueDate(iso: string): string {
  const [year = "", month = "", day = ""] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

const CUSTOMER_ORDERS_SHOWN = 10;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

export interface CustomerDetailScreenProps {
  /** The row already on the device: the ficha always opens from it, offline included. */
  readonly customer: CustomerListItem;
  readonly customers: CustomerRepository;
  readonly connectivity?: ConnectivityState;
  readonly onBack: () => void;
  readonly onNewOrder: (customer: CustomerListItem) => void;
  /** "Refazer" on a refused customer: opens the creation form pre-filled (the form is F8). Absent = no button. */
  readonly onRedo?: (customer: CustomerListItem) => void;
  /** "Editar": offered only when the installation released customer edit and the customer is a confirmed one. Absent = no button. */
  readonly onEdit?: (customer: CustomerListItem) => void;
  /** The device's own orders (the sync brings the account's orders from the site too): "Pedidos do cliente" and "Repetir último pedido". Absent = neither. */
  readonly localOrders?: Pick<LocalOrdersPort, "listSales">;
  /** "Repetir último pedido": opens a new order with the same customer and the products and quantities of that order, at today's price. */
  readonly onRepeatLast?: (localId: string) => void;
  /** "Pedidos recorrentes" of the customer (the section is built by the shell). Absent = none. */
  readonly templatesSection?: ReactNode;
}

/**
 * Customer sheet. Every section shows only data that really exists: the list item (cache) plus, when online,
 * the server detail (price table name, credit limit if the installation enables it). Contact, address, financial
 * position and purchase history are not delivered by the ERP mirror yet, so they are not shown (no zeros, no placeholders).
 * BUSINESS_RULE_UNDEFINED: whether a blocked/inactive customer may start an order is not decided anywhere (domain
 * `blocked` is "not decided here"; BLOQUEAR semantics NEEDS VALIDATION), so the ficha shows the real status only and never blocks.
 */
export function CustomerDetailScreen({ customer, customers, connectivity, onBack, onNewOrder, onRedo, onEdit, localOrders, onRepeatLast, templatesSection }: CustomerDetailScreenProps) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [financial, setFinancial] = useState<CustomerFinancial | null>(null);
  const [orders, setOrders] = useState<readonly SalesRow[]>([]);
  const online = connectivity !== "offline";
  const status = describeCustomerStatus(customer);
  // Waiting, queued or refused: no real code, no orders. A customer the ERP confirmed already has its real code and takes orders.
  const isPending = isUnconfirmedCustomer(customer);
  const noSeller = hasNoSeller(customer);
  const cannotOrder = isPending || noSeller;

  useEffect(() => {
    // A customer not confirmed yet does not exist on the server: nothing to ask for.
    if (!online || customers.get === undefined || isPending) return;
    let current = true;
    customers
      .get(customer.code)
      .then((found) => {
        if (current) setDetail(found);
      })
      .catch(() => undefined); // The ficha stays complete from the device data; the extra fields are optional.
    return () => {
      current = false;
    };
  }, [customer.code, isPending, customers, online]);

  useEffect(() => {
    if (!online || customers.financial === undefined || isPending) return;
    let current = true;
    customers
      .financial(customer.code)
      .then((found) => {
        if (current) setFinancial(found);
      })
      .catch(() => undefined); // Informational only: the sheet stays complete without it.
    return () => {
      current = false;
    };
  }, [customer.code, isPending, customers, online]);

  useEffect(() => {
    if (localOrders === undefined || isPending) return;
    let current = true;
    const filters = { ...EMPTY_SALES_FILTERS, customer: { code: customer.code, name: customer.name } };
    void Promise.all(((["unsent", "sent"]) as const).map((group) => localOrders.listSales({ ...filters, group }, { search: "", page: 1, pageSize: CUSTOMER_ORDERS_SHOWN })))
      .then((pages) => {
        if (!current) return;
        const rows = pages.flatMap((page) => page.items).sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
        setOrders(rows.slice(0, CUSTOMER_ORDERS_SHOWN));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [customer.code, customer.name, isPending, localOrders]);

  // Same rule as the site: the most recent order recorded in the Force (already accepted by the server) feeds the repeat.
  const lastRecorded = orders.find((row) => row.draft.status === "synced" && row.draft.remoteId !== null);

  const hasTradeName = customer.tradeName !== null && customer.tradeName !== customer.name;
  const priceTable =
    customer.priceTableCode === null
      ? null
      : detail?.priceTableName != null
        ? `${detail.priceTableName} (${customer.priceTableCode})`
        : String(customer.priceTableCode);

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <BackLink label="Clientes" onPress={onBack} accessibilityLabel="Voltar para Clientes" />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} accessibilityRole="header">{customer.name}</Text>
          {hasTradeName && <Text style={styles.trade}>{customer.tradeName}</Text>}
          <Text style={styles.meta}>{isPending ? (customer.document ?? "") : `Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}</Text>
          {status !== null && <Text style={styles.status}>{status}</Text>}
          {describePendingReason(customer.pending) !== null && <Text style={styles.status}>{describePendingReason(customer.pending)}</Text>}
        </View>

        <Section title="Dados principais">
          {!isPending && <Field label="Código" value={String(customer.code)} />}
          {customer.document !== null && <Field label="Documento" value={customer.document} />}
        </Section>

        {isPending && (
          <Section title="Financeiro">
            <Text style={styles.fieldValue}>{PENDING_CREDIT_NOTE}</Text>
          </Section>
        )}

        {(customer.sellerCode !== null || priceTable !== null) && (
          <Section title="Comercial">
            {customer.sellerCode !== null && <Field label="Vendedor" value={customer.sellerName ?? `Código ${customer.sellerCode}`} />}
            {priceTable !== null && <Field label="Tabela de preço" value={priceTable} />}
          </Section>
        )}

        {financial !== null && (
          <Section title="Financeiro">
            {financial.creditLimit !== null && <Field label="Limite de crédito" value={formatMoney(financial.creditLimit)} />}
            {financial.monthlyCreditLimit !== null && <Field label="Limite mensal" value={formatMoney(financial.monthlyCreditLimit)} />}
            <Field label="Em aberto" value={`${financial.summary.openCount} ${financial.summary.openCount === 1 ? "título" : "títulos"} · ${formatMoney(financial.summary.openAmount)}`} />
            {financial.summary.overdueCount !== null && financial.summary.overdueAmount !== null && (
              <Field
                label="Vencido"
                value={financial.summary.overdueCount === 0 ? "Nenhum título vencido" : `${financial.summary.overdueCount} ${financial.summary.overdueCount === 1 ? "título" : "títulos"} · ${formatMoney(financial.summary.overdueAmount)}`}
              />
            )}
            <Field label="Bloqueio" value={financial.blocked ? `Bloqueado${financial.blockReason ? ` — ${financial.blockReason}` : ""}` : "Sem bloqueio"} />
            <Text style={styles.sectionTitle} accessibilityRole="header">Títulos em aberto</Text>
            {financial.titles.length === 0 ? (
              <Text style={styles.note}>Nenhum título em aberto.</Text>
            ) : (
              financial.titles.map((title) => (
                <View key={title.nufin} style={styles.field} accessible accessibilityLabel={`Título com vencimento em ${formatDueDate(title.dueDate)}${title.overdue ? ", vencido" : ""}, saldo ${formatMoney(title.balance)}`}>
                  <Text style={styles.fieldValue}>{`${formatDueDate(title.dueDate)}${title.overdue ? " · Vencido" : ""}`}</Text>
                  <Text style={styles.fieldLabel}>{`${title.documentNumber !== null ? `Nota ${title.documentNumber} · ` : ""}Valor ${formatMoney(title.amount)} · Saldo ${formatMoney(title.balance)}`}</Text>
                </View>
              ))
            )}
            <Text style={styles.note}>{`Informação do Sankhya em ${formatDueDate(financial.checkedAt)}. Somente consulta.`}</Text>
          </Section>
        )}

        {orders.length > 0 && (
          <Section title="Pedidos do cliente">
            {orders.map((row) => (
              <View key={row.draft.localId} style={styles.field} accessible accessibilityLabel={`Pedido de ${describeSaleMeta(row.draft)}`}>
                <Text style={styles.fieldValue}>{describeSaleValue(row.value)}</Text>
                <Text style={styles.fieldLabel}>{describeSaleMeta(row.draft)}</Text>
                <SaleBadgeView status={row.draft.status} remoteId={row.draft.remoteId} lastError={row.draft.lastError} sendState={row.draft.sendState} sendCode={row.draft.sendCode} erpStage={row.draft.erpStage} />
              </View>
            ))}
          </Section>
        )}

        {financial === null && detail?.creditLimit != null && (
          <Section title="Financeiro">
            <Field label="Limite de crédito" value={formatMoney(detail.creditLimit)} />
          </Section>
        )}

        {templatesSection}

        {!online && <Text style={styles.note}>Sem conexão: dados salvos neste aparelho.</Text>}
      </ScrollView>

      <View style={styles.footer}>
        {isPending && <Text style={styles.status}>{PENDING_CUSTOMER_ORDER_MESSAGE}</Text>}
        {noSeller && <Text style={styles.status}>{NO_SELLER_ORDER_MESSAGE}</Text>}
        {customer.pending?.state === "rejected" && onRedo !== undefined && (
          <Pressable style={styles.cta} onPress={() => onRedo(customer)} accessibilityRole="button" accessibilityLabel="Refazer">
            <Text style={styles.ctaText}>Refazer</Text>
          </Pressable>
        )}
        {onRepeatLast !== undefined && lastRecorded !== undefined && !cannotOrder && (
          <Pressable style={styles.ctaSecondary} onPress={() => onRepeatLast(lastRecorded.draft.localId)} accessibilityRole="button" accessibilityLabel="Repetir último pedido">
            <Text style={styles.ctaSecondaryText}>Repetir último pedido</Text>
          </Pressable>
        )}
        {onEdit !== undefined && !isPending && (
          <Pressable style={styles.ctaSecondary} onPress={() => onEdit(customer)} accessibilityRole="button" accessibilityLabel="Editar cliente">
            <Text style={styles.ctaSecondaryText}>Editar cliente</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.cta, cannotOrder && styles.ctaDisabled]}
          onPress={() => !cannotOrder && onNewOrder(customer)}
          disabled={cannotOrder}
          accessibilityRole="button"
          accessibilityLabel="Novo pedido"
          accessibilityState={{ disabled: cannotOrder }}
        >
          <Text style={styles.ctaText}>Novo pedido</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.sm },
  back: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "700", color: colors.navy },
  content: { padding: spacing.lg, gap: spacing.lg },
  header: { gap: 2 },
  name: { fontSize: fontSize.title, fontWeight: "800", color: colors.navy },
  trade: { fontSize: 15, color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  status: { fontSize: 13, fontWeight: "700", color: colors.warning, marginTop: spacing.xs },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.navy },
  field: { gap: 1 },
  fieldLabel: { fontSize: 12, color: colors.textMuted },
  fieldValue: { fontSize: 15, color: colors.text, fontWeight: "600" },
  note: { fontSize: 12, color: colors.textMuted },
  footer: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  ctaSecondary: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  ctaSecondaryText: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
});
