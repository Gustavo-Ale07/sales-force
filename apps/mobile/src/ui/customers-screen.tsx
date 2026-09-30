import { StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerListItem, CustomerRepository } from "../data/ports";
import { colors, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";

export function describeCustomerStatus(customer: Pick<CustomerListItem, "active" | "blocked">): string | null {
  if (customer.blocked) return "Bloqueado";
  if (!customer.active) return "Inativo";
  return null;
}

function CustomerRow({ customer }: { customer: CustomerListItem }) {
  const status = describeCustomerStatus(customer);
  return (
    <View style={styles.row} accessible>
      <View style={styles.nameLine}>
        <Text style={styles.name} numberOfLines={2}>{customer.name}</Text>
        {status !== null && <Text style={styles.status}>{status}</Text>}
      </View>
      {customer.tradeName !== null && customer.tradeName !== customer.name && <Text style={styles.meta} numberOfLines={1}>{customer.tradeName}</Text>}
      <Text style={styles.meta} numberOfLines={1}>{`Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}</Text>
      {customer.sellerName !== null && <Text style={styles.seller} numberOfLines={1}>{`Vendedor: ${customer.sellerName}`}</Text>}
    </View>
  );
}

export interface CustomersScreenProps {
  readonly customers: CustomerRepository;
  readonly onUnauthenticated: () => void;
  readonly connectivity?: ConnectivityState;
}

/** Customer portfolio (scoped by the server), searchable offline from the device cache. Read-only for now (the full customer sheet is M3). */
export function CustomersScreen({ customers, onUnauthenticated, connectivity }: CustomersScreenProps) {
  const offlineSuffix = connectivity === "offline" ? " · dados salvos neste aparelho" : "";
  return (
    <PagedListView
      load={(request) => customers.list(request)}
      keyOf={(customer) => String(customer.code)}
      renderItem={(customer) => <CustomerRow customer={customer} />}
      title="Clientes"
      describeCount={(total, searching) =>
        (searching ? `${total} ${total === 1 ? "resultado" : "resultados"}` : `${total} ${total === 1 ? "cliente" : "clientes"}`) + offlineSuffix
      }
      searchLabel="Buscar cliente"
      searchPlaceholder="Buscar por nome, código ou documento"
      loadingText="Carregando clientes..."
      emptyText="Nenhum cliente disponível"
      emptyHint="Conecte-se e sincronize para carregar a sua carteira neste aparelho."
      noResultText={(search) => `Nenhum cliente encontrado para “${search}”.`}
      onUnauthenticated={onUnauthenticated}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
    gap: 1,
    minHeight: 56,
  },
  nameLine: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  name: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  seller: { fontSize: 12, color: colors.textMuted, opacity: 0.85 },
  status: { fontSize: 12, fontWeight: "700", color: colors.warning },
});
