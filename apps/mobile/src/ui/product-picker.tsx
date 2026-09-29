import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProductListItem, ProductRepository } from "../data/ports";
import { describeListPrice } from "../lib/money";
import { colors, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";

function PickRow({ product, inCart, onAdd }: { product: ProductListItem; inCart: boolean; onAdd: (product: ProductListItem) => void }) {
  const noPrice = product.listPrice.state === "none";
  const disabled = !product.sellable;
  return (
    <View style={styles.row} accessible>
      <View style={styles.info}>
        <Text style={styles.name}>{product.description}</Text>
        <Text style={styles.meta}>
          {`Código ${product.code} · ${product.unit}${product.groupName !== null ? ` · ${product.groupName}` : ""}`}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.price, noPrice && styles.noPrice]}>{describeListPrice(product.listPrice)}</Text>
          {disabled && <Text style={styles.notSellable}>Indisponível para venda</Text>}
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [styles.addButton, disabled && styles.addButtonDisabled, pressed && !disabled && styles.addButtonPressed]}
        onPress={() => !disabled && onAdd(product)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={inCart ? `${product.description}, já no carrinho, adicionar outra unidade` : `Adicionar ${product.description} ao carrinho`}
      >
        <Text style={styles.addButtonText}>{inCart ? "+1" : "Adicionar"}</Text>
      </Pressable>
    </View>
  );
}

export interface ProductPickerProps {
  readonly products: ProductRepository;
  readonly cartProductCodes: ReadonlySet<number>;
  readonly onAdd: (product: ProductListItem) => void;
  readonly onUnauthenticated: () => void;
}

/** Step 2 of the new-order flow: browse the catalog and add lines to the cart. Non-sellable products cannot be added. */
export function ProductPicker({ products, cartProductCodes, onAdd, onUnauthenticated }: ProductPickerProps) {
  return (
    <PagedListView
      load={(request) => products.list(request)}
      keyOf={(product) => String(product.code)}
      renderItem={(product) => <PickRow product={product} inCart={cartProductCodes.has(product.code)} onAdd={onAdd} />}
      searchLabel="Buscar produto por descrição ou código"
      emptyText="Nenhum produto encontrado."
      onUnauthenticated={onUnauthenticated}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  price: { fontSize: 15, fontWeight: "700", color: colors.navy },
  noPrice: { color: colors.textMuted, fontStyle: "italic" },
  notSellable: { fontSize: 12, fontWeight: "700", color: colors.warning },
  addButton: { backgroundColor: colors.navy, borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  addButtonPressed: { backgroundColor: colors.navyStrong },
  addButtonDisabled: { backgroundColor: colors.border },
  addButtonText: { color: colors.onNavy, fontWeight: "700", fontSize: 13 },
});
