import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerDetail, CustomerListItem, CustomerRepository } from "../data/ports";
import { colors, spacing } from "../theme";
import { describeCustomerStatus } from "./customers-screen";

/** "1234.5" -> "R$ 1.234,50" without depending on Intl (not guaranteed on every Hermes build). */
function formatMoney(decimal: string): string {
  const [integer = "0", fraction = ""] = decimal.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

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
}

/**
 * Customer sheet. Every section shows only data that really exists: the list item (cache) plus, when online,
 * the server detail (price table name, credit limit if the installation enables it). Contact, address, financial
 * position and purchase history are not delivered by the ERP mirror yet, so they are not shown (no zeros, no placeholders).
 * BUSINESS_RULE_UNDEFINED: whether a blocked/inactive customer may start an order is not decided anywhere (domain
 * `blocked` is "not decided here"; BLOQUEAR semantics NEEDS VALIDATION), so the ficha shows the real status only and never blocks.
 */
export function CustomerDetailScreen({ customer, customers, connectivity, onBack, onNewOrder }: CustomerDetailScreenProps) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const online = connectivity !== "offline";
  const status = describeCustomerStatus(customer);

  useEffect(() => {
    if (!online || customers.get === undefined) return;
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
  }, [customer.code, customers, online]);

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
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Voltar para Clientes">
          <Text style={styles.backText}>‹ Clientes</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} accessibilityRole="header">{customer.name}</Text>
          {hasTradeName && <Text style={styles.trade}>{customer.tradeName}</Text>}
          <Text style={styles.meta}>{`Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}</Text>
          {status !== null && <Text style={styles.status}>{status}</Text>}
        </View>

        <Section title="Dados principais">
          <Field label="Código" value={String(customer.code)} />
          {customer.document !== null && <Field label="Documento" value={customer.document} />}
        </Section>

        {(customer.sellerCode !== null || priceTable !== null) && (
          <Section title="Comercial">
            {customer.sellerCode !== null && <Field label="Vendedor" value={customer.sellerName ?? `Código ${customer.sellerCode}`} />}
            {priceTable !== null && <Field label="Tabela de preço" value={priceTable} />}
          </Section>
        )}

        {detail?.creditLimit != null && (
          <Section title="Financeiro">
            <Field label="Limite de crédito" value={formatMoney(detail.creditLimit)} />
          </Section>
        )}

        <Text style={styles.note}>Histórico comercial ainda não disponível neste dispositivo.</Text>
        {!online && <Text style={styles.note}>Sem conexão: dados salvos neste aparelho.</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cta} onPress={() => onNewOrder(customer)} accessibilityRole="button" accessibilityLabel="Novo pedido">
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
  name: { fontSize: 22, fontWeight: "800", color: colors.navy },
  trade: { fontSize: 15, color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  status: { fontSize: 13, fontWeight: "700", color: colors.warning, marginTop: spacing.xs },
  section: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.navy },
  field: { gap: 1 },
  fieldLabel: { fontSize: 12, color: colors.textMuted },
  fieldValue: { fontSize: 15, color: colors.text, fontWeight: "600" },
  note: { fontSize: 12, color: colors.textMuted },
  footer: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { minHeight: 50, borderRadius: 8, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  ctaText: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
});
