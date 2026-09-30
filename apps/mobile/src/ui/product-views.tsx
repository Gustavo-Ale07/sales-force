import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProductListItem } from "../data/ports";
import { describeListPrice } from "../lib/money";
import { colors, spacing } from "../theme";

export type ProductViewMode = "grid" | "list";

/** Order-mode hooks. Without them the catalog is read-only (consultation). */
export interface ProductOrderActions {
  /** Whole quantity already in the cart for a product, as typed in its line; absent when not in the cart. */
  readonly quantityOf: (productCode: number) => string | undefined;
  readonly onAdd: (product: ProductListItem) => void;
  readonly onDecrement: (product: ProductListItem) => void;
}

/**
 * No product image exists in the ERP mirror or in the cache (spike W-14: image UNAVAILABLE, blobs live in object
 * storage, P-17), so every product shows this neutral placeholder. Nothing is fetched and nothing is invented.
 */
function Thumb({ product, size }: { product: ProductListItem; size: "card" | "row" }) {
  const initials = product.description.trim().slice(0, 2).toUpperCase();
  return (
    <View style={[styles.thumb, size === "card" ? styles.thumbCard : styles.thumbRow]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.thumbText, size === "row" && styles.thumbTextRow]}>{initials}</Text>
    </View>
  );
}

function priceLabel(product: ProductListItem): string {
  return describeListPrice(product.listPrice);
}

/** "Adicionar" when the product is not in the cart, "− qty +" when it is. Non-sellable products cannot be added. */
function AddControl({ product, quantity, actions }: { product: ProductListItem; quantity: string | undefined; actions: ProductOrderActions }) {
  if (!product.sellable) return <Text style={styles.notSellable}>Indisponível para venda</Text>;
  if (quantity === undefined) {
    return (
      <Pressable
        style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        onPress={() => actions.onAdd(product)}
        accessibilityRole="button"
        accessibilityLabel={`Adicionar ${product.description} ao carrinho`}
      >
        <Text style={styles.addText}>Adicionar</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.stepper}>
      <Pressable
        style={styles.step}
        onPress={() => actions.onDecrement(product)}
        accessibilityRole="button"
        accessibilityLabel={quantity === "1" ? `Remover ${product.description} do carrinho` : `Diminuir quantidade de ${product.description}`}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.qty} accessibilityLabel={`Quantidade no carrinho: ${quantity}`}>{quantity}</Text>
      <Pressable
        style={styles.step}
        onPress={() => actions.onAdd(product)}
        accessibilityRole="button"
        accessibilityLabel={`${product.description}, já no carrinho, adicionar outra unidade`}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

interface ViewProps {
  readonly product: ProductListItem;
  readonly quantity?: string | undefined;
  readonly actions?: ProductOrderActions | undefined;
}

function describe(product: ProductListItem, quantity: string | undefined): string {
  const parts = [product.description, `código ${product.code}`, product.unit, priceLabel(product)];
  if (quantity !== undefined) parts.push(`${quantity} no carrinho`);
  return parts.join(", ");
}

function CardImpl({ product, quantity, actions }: ViewProps) {
  const noPrice = product.listPrice.state === "none";
  return (
    <View style={styles.card} accessible={actions === undefined} accessibilityLabel={actions === undefined ? describe(product, quantity) : undefined}>
      <Thumb product={product} size="card" />
      <Text style={styles.cardName} numberOfLines={2}>{product.description}</Text>
      <Text style={styles.meta} numberOfLines={1}>{`Cód. ${product.code} · ${product.unit}`}</Text>
      {product.groupName !== null && <Text style={styles.group} numberOfLines={1}>{product.groupName}</Text>}
      <Text style={[styles.price, noPrice && styles.noPrice]}>{priceLabel(product)}</Text>
      {actions !== undefined && (
        <View style={styles.cardAction}>
          <AddControl product={product} quantity={quantity} actions={actions} />
        </View>
      )}
    </View>
  );
}

function RowImpl({ product, quantity, actions }: ViewProps) {
  const noPrice = product.listPrice.state === "none";
  return (
    <View style={styles.row} accessible={actions === undefined} accessibilityLabel={actions === undefined ? describe(product, quantity) : undefined}>
      <Thumb product={product} size="row" />
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>{product.description}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`Código ${product.code} · ${product.unit}${product.groupName !== null ? ` · ${product.groupName}` : ""}`}</Text>
        <Text style={[styles.price, noPrice && styles.noPrice]}>{priceLabel(product)}</Text>
      </View>
      {actions !== undefined && <AddControl product={product} quantity={quantity} actions={actions} />}
      {actions === undefined && !product.sellable && <Text style={styles.notSellable}>Indisponível</Text>}
    </View>
  );
}

// Memoized: a cart change re-renders only the cards whose quantity changed (the row object is stable per page).
export const ProductCard = memo(CardImpl);
export const ProductRow = memo(RowImpl);

const styles = StyleSheet.create({
  thumb: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  thumbCard: { height: 56, borderRadius: 8, alignSelf: "stretch" },
  thumbRow: { width: 48, height: 48, borderRadius: 8 },
  thumbText: { fontSize: 22, fontWeight: "800", color: colors.textMuted },
  thumbTextRow: { fontSize: 16 },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, margin: spacing.xs, gap: 2 },
  cardName: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: spacing.xs, minHeight: 36 },
  cardAction: { marginTop: spacing.xs, alignItems: "stretch" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.xs + 2, gap: spacing.sm },
  rowInfo: { flex: 1, gap: 1 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  group: { fontSize: 11, color: colors.textMuted, opacity: 0.85 },
  price: { fontSize: 15, fontWeight: "800", color: colors.navy },
  noPrice: { color: colors.textMuted, fontStyle: "italic", fontWeight: "600" },
  notSellable: { fontSize: 12, fontWeight: "700", color: colors.warning },
  add: { minHeight: 44, minWidth: 88, paddingHorizontal: spacing.md, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  addPressed: { opacity: 0.8 },
  addText: { color: colors.onNavy, fontWeight: "700", fontSize: 13 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 8, borderWidth: 1, borderColor: colors.navy, minHeight: 44 },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 22, fontWeight: "700", color: colors.navy },
  qty: { minWidth: 28, textAlign: "center", fontSize: 15, fontWeight: "800", color: colors.text },
});
