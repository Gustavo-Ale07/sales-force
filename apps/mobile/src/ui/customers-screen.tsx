import { StyleSheet, Text, View } from "react-native";
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
      <Text style={styles.name}>{customer.name}</Text>
      {customer.tradeName !== null && customer.tradeName !== customer.name && (
        <Text style={styles.meta}>{customer.tradeName}</Text>
      )}
      <Text style={styles.meta}>{`Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}</Text>
      {customer.sellerName !== null && <Text style={styles.meta}>{`Vendedor: ${customer.sellerName}`}</Text>}
      {status !== null && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

export interface CustomersScreenProps {
  readonly customers: CustomerRepository;
  readonly onUnauthenticated: () => void;
}

/** Customer portfolio (scoped by the server). Read-only for now. */
export function CustomersScreen({ customers, onUnauthenticated }: CustomersScreenProps) {
  return (
    <PagedListView
      load={(request) => customers.list(request)}
      keyOf={(customer) => String(customer.code)}
      renderItem={(customer) => <CustomerRow customer={customer} />}
      searchLabel="Buscar cliente por nome ou código"
      emptyText="Nenhum cliente encontrado na sua carteira."
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
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 12, fontWeight: "700", color: colors.warning, marginTop: spacing.xs },
});
