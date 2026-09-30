import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { ProductFilters, ProductGroupOption, ProductListItem, ProductPageRequest, ProductRepository } from "../data/ports";
import { colors, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";
import { ProductFilterChips, ProductFiltersSheet, countActiveProductFilters } from "./product-filters";
import { ProductCard, ProductRow, type ProductOrderActions, type ProductViewMode } from "./product-views";

export interface ProductBrowserProps {
  readonly products: ProductRepository;
  readonly onUnauthenticated: () => void;
  readonly connectivity?: ConnectivityState | undefined;
  /** Selection mode (Novo pedido): add button, quantity stepper and "already in the cart" state. Absent = consultation. */
  readonly actions?: ProductOrderActions | undefined;
  /** Screen title ("Catálogo"); omitted inside an order, where the order header already gives the context. */
  readonly title?: string | undefined;
}

/**
 * The one product browser: search, group/price filters, Grid/Lista toggle and the truthful count. Used by the
 * Catálogo tab (consultation) and by the product step of Novo pedido (selection), so both share the same rules.
 */
export function ProductBrowser({ products, onUnauthenticated, connectivity, actions, title }: ProductBrowserProps) {
  const offlineSuffix = connectivity === "offline" ? " · dados salvos neste aparelho" : "";
  const [mode, setMode] = useState<ProductViewMode>("grid");
  const [filters, setFilters] = useState<ProductFilters>({});
  const [groups, setGroups] = useState<readonly ProductGroupOption[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const active = countActiveProductFilters(filters);
  const canFilter = products.groups !== undefined;

  useEffect(() => {
    let current = true;
    void products.groups?.().then((found) => current && setGroups(found)).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [products]);

  const extra = useMemo(() => (active > 0 ? { filters } : {}), [active, filters]);
  const onSearchChange = useCallback(() => undefined, []);

  const header = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarRow}>
        {canFilter && (
          <Pressable
            style={[styles.tool, active > 0 && styles.toolOn]}
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={active > 0 ? `Filtros, ${active} ativo(s)` : "Filtros"}
          >
            <Text style={[styles.toolText, active > 0 && styles.toolTextOn]}>{active > 0 ? `Filtros (${active})` : "Filtros"}</Text>
          </Pressable>
        )}
        <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Visualização">
          {(["grid", "list"] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.toggleItem, mode === option && styles.toggleItemOn]}
              onPress={() => setMode(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === option }}
              accessibilityLabel={option === "grid" ? "Grade" : "Lista"}
            >
              <Text style={[styles.toggleText, mode === option && styles.toggleTextOn]}>{option === "grid" ? "Grade" : "Lista"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ProductFilterChips filters={filters} groups={groups} onChange={setFilters} />
      <ProductFiltersSheet
        visible={filtersOpen}
        filters={filters}
        groups={groups}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );

  const renderItem = (product: ProductListItem) => {
    const quantity = actions?.quantityOf(product.code);
    return mode === "grid" ? (
      <View style={styles.cell}>
        <ProductCard product={product} quantity={quantity} actions={actions} />
      </View>
    ) : (
      <ProductRow product={product} quantity={quantity} actions={actions} />
    );
  };

  return (
    <PagedListView<ProductListItem, ProductPageRequest>
      load={(request) => products.list(request)}
      extra={extra}
      onSearchChange={onSearchChange}
      header={header}
      keyOf={(product) => String(product.code)}
      renderItem={renderItem}
      columns={mode === "grid" ? 2 : 1}
      {...(title !== undefined
        ? {
            title,
            describeCount: (total: number, searching: boolean) => {
              const noun = searching || active > 0 ? (total === 1 ? "resultado" : "resultados") : total === 1 ? "produto" : "produtos";
              return `${total} ${noun}${offlineSuffix}`;
            },
          }
        : {})}
      searchLabel="Buscar produto por descrição ou código"
      searchPlaceholder="Buscar por código ou descrição"
      loadingText="Carregando catálogo..."
      emptyText="Nenhum produto disponível"
      emptyHint="Conecte-se e sincronize para carregar o catálogo neste aparelho."
      {...(active > 0 ? { filteredEmptyText: "Nenhum produto com estes filtros." } : {})}
      noResultText={(text) => (active > 0 ? `Nenhum produto encontrado para “${text}” com estes filtros.` : `Nenhum produto encontrado para “${text}”.`)}
      noResultHint="Confira a descrição ou o código."
      onUnauthenticated={onUnauthenticated}
    />
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: spacing.sm },
  toolbarRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "space-between" },
  tool: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.lg, borderRadius: 8, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  toolOn: { backgroundColor: colors.navy },
  toolText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toolTextOn: { color: colors.onNavy },
  toggle: { flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: colors.navy, overflow: "hidden" },
  toggleItem: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  toggleItemOn: { backgroundColor: colors.navy },
  toggleText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toggleTextOn: { color: colors.onNavy },
  cell: { flex: 1, maxWidth: "50%" },
});
