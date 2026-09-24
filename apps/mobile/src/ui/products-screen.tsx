import { StyleSheet, Text, View } from "react-native";
import type { ProductListItem, ProductRepository } from "../data/ports";
import { describeListPrice } from "../lib/money";
import { colors, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";

function ProductRow({ product }: { product: ProductListItem }) {
  const noPrice = product.listPrice.state === "none";
  return (
    <View style={styles.row} accessible>
      <Text style={styles.name}>{product.description}</Text>
      <Text style={styles.meta}>
        {`Código ${product.code} · ${product.unit}${product.groupName !== null ? ` · ${product.groupName}` : ""}`}
      </Text>
      <View style={styles.footer}>
        <Text style={[styles.price, noPrice && styles.noPrice]}>{describeListPrice(product.listPrice)}</Text>
        {!product.sellable && <Text style={styles.notSellable}>Indisponível para venda</Text>}
      </View>
    </View>
  );
}

export interface ProductsScreenProps {
  readonly products: ProductRepository;
  readonly onUnauthenticated: () => void;
}

/** Product catalog with list prices as resolved by the server (catalog reference table). Read-only for now. */
export function ProductsScreen({ products, onUnauthenticated }: ProductsScreenProps) {
  return (
    <PagedListView
      load={(request) => products.list(request)}
      keyOf={(product) => String(product.code)}
      renderItem={(product) => <ProductRow product={product} />}
      searchLabel="Buscar produto por descrição ou código"
      emptyText="Nenhum produto encontrado."
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
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  price: { fontSize: 15, fontWeight: "700", color: colors.navy },
  noPrice: { color: colors.textMuted, fontStyle: "italic" },
  notSellable: { fontSize: 12, fontWeight: "700", color: colors.warning },
});
