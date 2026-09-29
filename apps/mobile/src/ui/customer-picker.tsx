import { Pressable, StyleSheet, Text } from "react-native";
import type { CustomerListItem, CustomerRepository } from "../data/ports";
import { colors, spacing } from "../theme";
import { describeCustomerStatus } from "./customers-screen";
import { PagedListView } from "./paged-list-view";

function PickRow({ customer, onSelect }: { customer: CustomerListItem; onSelect: (customer: CustomerListItem) => void }) {
  const status = describeCustomerStatus(customer);
  const disabled = status !== null;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, disabled && styles.rowDisabled, pressed && !disabled && styles.rowPressed]}
      onPress={() => !disabled && onSelect(customer)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Selecionar cliente ${customer.name}`}
      accessibilityState={{ disabled }}
    >
      <Text style={styles.name}>{customer.name}</Text>
      {customer.tradeName !== null && customer.tradeName !== customer.name && (
        <Text style={styles.meta}>{customer.tradeName}</Text>
      )}
      <Text style={styles.meta}>
        {`Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}
      </Text>
      {status !== null && <Text style={styles.status}>{status}</Text>}
    </Pressable>
  );
}

export interface CustomerPickerProps {
  readonly customers: CustomerRepository;
  readonly onSelect: (customer: CustomerListItem) => void;
  readonly onUnauthenticated: () => void;
}

/** Step 1 of the new-order flow: pick the customer the draft is for. Blocked/inactive customers cannot be selected. */
export function CustomerPicker({ customers, onSelect, onUnauthenticated }: CustomerPickerProps) {
  return (
    <PagedListView
      load={(request) => customers.list(request)}
      keyOf={(customer) => String(customer.code)}
      renderItem={(customer) => <PickRow customer={customer} onSelect={onSelect} />}
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
  rowPressed: { backgroundColor: colors.background },
  rowDisabled: { opacity: 0.5 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 12, fontWeight: "700", color: colors.warning, marginTop: spacing.xs },
});
