import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { ProductFilters, ProductListItem, ProductPageRequest, ProductRepository } from "../data/ports";
import { colors, control, radius, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";
import { pricesOriginText, type PricesOrigin } from "../data/prices-origin";
import type { ProductGroupTree } from "../data/group-cascade";
import { EMPTY_GROUP_TREE, ProductFilterChips, ProductFiltersSheet, countActiveProductFilters } from "./product-filters";
import { ProductDetailSheet } from "./product-detail-sheet";
import { ProductCard, ProductRow, type ProductOrderActions, type ProductViewMode } from "./product-views";

export interface ProductBrowserProps {
  readonly products: ProductRepository;
  readonly onUnauthenticated: () => void;
  readonly connectivity?: ConnectivityState | undefined;
  /** Selection mode (Novo pedido): add button, quantity stepper and "already in the cart" state. Absent = consultation. */
  readonly actions?: ProductOrderActions | undefined;
  /** Screen title ("Catálogo"); omitted inside an order, where the order header already gives the context. */
  readonly title?: string | undefined;
  /** Order customer (selection mode): reloads the catalog of this customer's price table when it changes. */
  readonly customerCode?: number | undefined;
}

/**
 * The one product browser: search, group/price filters, Grid/Lista toggle and the truthful count. Used by the
 * Catálogo tab (consultation) and by the product step of Novo pedido (selection), so both share the same rules.
 */
export function ProductBrowser({ products, onUnauthenticated, connectivity, actions, title, customerCode }: ProductBrowserProps) {
  const offlineSuffix = connectivity === "offline" ? " · dados salvos neste aparelho" : "";
  const [mode, setMode] = useState<ProductViewMode>("grid");
  const [filters, setFilters] = useState<ProductFilters>({});
  const [detail, setDetail] = useState<ProductListItem | null>(null);
  const [groups, setGroups] = useState<ProductGroupTree>(EMPTY_GROUP_TREE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [origin, setOrigin] = useState<PricesOrigin | null>(null);
  const active = countActiveProductFilters(filters);
  const canFilter = products.groupTree !== undefined;

  useEffect(() => {
    let current = true;
    void products.groupTree?.().then((found) => current && setGroups(found)).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [products]);

  // Where the list prices come from; follows the order customer (his table).
  useEffect(() => {
    let current = true;
    void products.pricesOrigin?.(customerCode).then((found) => current && setOrigin(found)).catch(() => current && setOrigin(null));
    return () => {
      current = false;
    };
  }, [products, customerCode]);

  const extra = useMemo(() => ({ ...(active > 0 ? { filters } : {}), ...(customerCode === undefined ? {} : { customerCode }) }), [active, filters, customerCode]);
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
      {origin !== null && <Text style={styles.origin} accessibilityLabel={pricesOriginText(origin)}>{pricesOriginText(origin)}</Text>}
      <ProductFilterChips filters={filters} tree={groups} onChange={setFilters} />
      <ProductFiltersSheet
        visible={filtersOpen}
        filters={filters}
        tree={groups}
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
        <ProductCard product={product} quantity={quantity} actions={actions} onOpen={setDetail} />
      </View>
    ) : (
      <ProductRow product={product} quantity={quantity} actions={actions} onOpen={setDetail} />
    );
  };

  return (
    <>
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
      {...(active > 0 ? { filteredEmptyText: "Nenhum produto com estes filtros." } : {})}
      noResultText={(text) => (active > 0 ? `Nenhum produto encontrado para “${text}” com estes filtros.` : `Nenhum produto encontrado para “${text}”.`)}
      noResultHint="Confira a descrição ou o código."
      onUnauthenticated={onUnauthenticated}
    />
    <ProductDetailSheet product={detail} onClose={() => setDetail(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  origin: { fontSize: 13, color: colors.textMuted },
  toolbar: { gap: spacing.sm },
  toolbarRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "space-between" },
  tool: { minHeight: control.height, minWidth: 72, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  toolOn: { backgroundColor: colors.navy },
  toolText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toolTextOn: { color: colors.onNavy },
  toggle: { flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, overflow: "hidden" },
  toggleItem: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  toggleItemOn: { backgroundColor: colors.navy },
  toggleText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toggleTextOn: { color: colors.onNavy },
  cell: { flex: 1, maxWidth: "50%" },
});
