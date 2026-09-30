import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerFilters, CustomerLetter, CustomerListItem, CustomerPageRequest, CustomerRepository, CustomerSellerOption } from "../data/ports";
import { colors, spacing } from "../theme";
import { CustomerFiltersSheet, CustomerIndexSheet, FilterChips, countActiveFilters } from "./customer-filters";
import { PagedListView } from "./paged-list-view";

export function describeCustomerStatus(customer: Pick<CustomerListItem, "active" | "blocked">): string | null {
  if (customer.blocked) return "Bloqueado";
  if (!customer.active) return "Inativo";
  return null;
}

function CustomerRow({ customer, onOpen }: { customer: CustomerListItem; onOpen: (customer: CustomerListItem) => void }) {
  const status = describeCustomerStatus(customer);
  return (
    <Pressable
      style={styles.row}
      onPress={() => onOpen(customer)}
      accessibilityRole="button"
      accessibilityLabel={`${customer.name}, código ${customer.code}${status !== null ? `, ${status}` : ""}. Abrir ficha`}
    >
      <View style={styles.nameLine}>
        <Text style={styles.name} numberOfLines={2}>{customer.name}</Text>
        {status !== null && <Text style={styles.status}>{status}</Text>}
      </View>
      {customer.tradeName !== null && customer.tradeName !== customer.name && <Text style={styles.meta} numberOfLines={1}>{customer.tradeName}</Text>}
      <Text style={styles.meta} numberOfLines={1}>{`Código ${customer.code}${customer.document !== null ? ` · ${customer.document}` : ""}`}</Text>
      {customer.sellerName !== null && <Text style={styles.seller} numberOfLines={1}>{`Vendedor: ${customer.sellerName}`}</Text>}
    </Pressable>
  );
}

export interface CustomersScreenProps {
  readonly customers: CustomerRepository;
  readonly onUnauthenticated: () => void;
  readonly connectivity?: ConnectivityState;
  /** Opens the customer sheet (ficha). */
  readonly onOpen?: (customer: CustomerListItem) => void;
}

const noopOpen = () => undefined;

/**
 * Customer portfolio (scoped by the server), searchable and filterable offline from the device cache, with an
 * alphabetical index when the repository can compute it locally. Whether this is "the seller's own portfolio" depends
 * on the installation configuration the app does not know, so the title never claims it.
 */
export function CustomersScreen({ customers, onUnauthenticated, connectivity, onOpen = noopOpen }: CustomersScreenProps) {
  const offlineSuffix = connectivity === "offline" ? " · dados salvos neste aparelho" : "";
  const [filters, setFilters] = useState<CustomerFilters>({});
  const [startAt, setStartAt] = useState(0);
  const [search, setSearch] = useState("");
  const [letters, setLetters] = useState<readonly CustomerLetter[]>([]);
  const [sellers, setSellers] = useState<readonly CustomerSellerOption[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const filtersKey = JSON.stringify(filters);
  const activeFilters = countActiveFilters(filters);

  useEffect(() => {
    let current = true;
    void customers.sellers?.().then((found) => current && setSellers(found)).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [customers]);

  useEffect(() => {
    if (customers.letters === undefined) return;
    let current = true;
    customers
      .letters({ search, filters })
      .then((found) => current && setLetters(found))
      .catch(() => current && setLetters([]));
    return () => {
      current = false;
    };
    // `filters` is tracked through its serialized key so an equal object does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, search, filtersKey]);

  const onSearchChange = useCallback((next: string) => {
    setSearch(next);
    setStartAt(0);
  }, []);
  const changeFilters = (next: CustomerFilters) => {
    setFilters(next);
    setStartAt(0);
  };
  const extra = useMemo(() => ({ filters, startAt }), [filters, startAt]);
  const letterTotal = letters.reduce((sum, entry) => sum + entry.count, 0);
  const canIndex = customers.letters !== undefined && letters.length > 0;

  const header = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarRow}>
        <Pressable
          style={[styles.tool, activeFilters > 0 && styles.toolOn]}
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={activeFilters > 0 ? `Filtros, ${activeFilters} ativo(s)` : "Filtros"}
        >
          <Text style={[styles.toolText, activeFilters > 0 && styles.toolTextOn]}>{activeFilters > 0 ? `Filtros (${activeFilters})` : "Filtros"}</Text>
        </Pressable>
        {canIndex && (
          <Pressable style={styles.tool} onPress={() => setIndexOpen(true)} accessibilityRole="button" accessibilityLabel="Índice alfabético">
            <Text style={styles.toolText}>A–Z</Text>
          </Pressable>
        )}
      </View>
      <FilterChips filters={filters} sellers={sellers} onChange={changeFilters} />
      {startAt > 0 && (
        <Pressable style={styles.jump} onPress={() => setStartAt(0)} accessibilityRole="button" accessibilityLabel="Voltar ao início da lista">
          <Text style={styles.jumpText}>{`Começando em “${letters.find((entry) => entry.offset === startAt)?.letter ?? "…"}” · Voltar ao início`}</Text>
        </Pressable>
      )}
      <CustomerFiltersSheet
        visible={filtersOpen}
        filters={filters}
        sellers={sellers}
        onApply={(next) => {
          changeFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
      <CustomerIndexSheet
        visible={indexOpen}
        letters={letters}
        activeOffset={startAt}
        onPick={(entry) => {
          setStartAt(entry === null ? 0 : entry.offset);
          setIndexOpen(false);
        }}
        onClose={() => setIndexOpen(false)}
      />
    </View>
  );

  return (
    <PagedListView<CustomerListItem, CustomerPageRequest>
      load={(request) => customers.list(request)}
      extra={extra}
      onSearchChange={onSearchChange}
      header={header}
      keyOf={(customer) => String(customer.code)}
      renderItem={(customer) => <CustomerRow customer={customer} onOpen={onOpen} />}
      title="Clientes"
      describeCount={(total, searching) => {
        const shown = startAt > 0 && letterTotal > 0 ? letterTotal : total;
        const noun = searching || activeFilters > 0 ? (shown === 1 ? "resultado" : "resultados") : shown === 1 ? "cliente" : "clientes";
        return `${shown} ${noun}${offlineSuffix}`;
      }}
      searchLabel="Buscar cliente"
      searchPlaceholder="Buscar por nome, código ou documento"
      loadingText="Carregando clientes..."
      emptyText="Nenhum cliente disponível"
      emptyHint="Conecte-se e sincronize para carregar a sua carteira neste aparelho."
      {...(activeFilters > 0 ? { filteredEmptyText: "Nenhum cliente com estes filtros." } : {})}
      noResultText={(text) => (activeFilters > 0 ? `Nenhum cliente encontrado para “${text}” com estes filtros.` : `Nenhum cliente encontrado para “${text}”.`)}
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
  toolbar: { gap: spacing.sm },
  toolbarRow: { flexDirection: "row", gap: spacing.sm },
  tool: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.lg, borderRadius: 8, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  jump: { minHeight: 44, justifyContent: "center" },
  jumpText: { color: colors.navy, fontSize: 13, fontWeight: "700" },
  toolOn: { backgroundColor: colors.navy },
  toolText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toolTextOn: { color: colors.onNavy },
});
