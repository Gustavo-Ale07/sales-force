import { memo, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { ProductListItem } from "../data/ports";
import { useProductImages } from "../images/product-image-context";
import { describeListPrice } from "../lib/money";
import { colors, control, fontSize, radius, spacing } from "../theme";
import { QuantityField } from "./quantity-field";

export type ProductViewMode = "grid" | "list";

/** Width reserved at the right of a list row for "Adicionar" or "- qty +" (40 + 40 for the buttons, the rest for the number). */
export const ROW_ACTION_WIDTH = 136;

/** Order-mode hooks. Without them the catalog is read-only (consultation). */
export interface ProductOrderActions {
  /** Whole quantity already in the cart for a product, as typed in its line; absent when not in the cart. */
  readonly quantityOf: (productCode: number) => string | undefined;
  readonly onAdd: (product: ProductListItem) => void;
  readonly onDecrement: (product: ProductListItem) => void;
  /** Quantity typed in the field between "−" and "+", already validated; absent = the number is read-only. */
  readonly onSetQuantity?: (product: ProductListItem, result: { kind: "set"; quantityText: string } | { kind: "remove" }) => void;
}

/**
 * Product thumbnail. The initials placeholder is the base state and the final one whenever there is no image
 * (`image` null/absent), the server says 404, the request fails or times out, the bytes are not a valid image, or the
 * device is offline and the thumbnail was never stored. When `image` metadata is present the thumbnail is resolved
 * lazily by the mounted row (virtualized lists mount only visible rows) through the authenticated store and shown from
 * an app-private file, never from a bare remote uri or base64. A row that unmounts cancels a download not yet started.
 */
function ProductThumb({ product, size }: { product: ProductListItem; size: "card" | "row" }) {
  return <Thumb code={product.code} description={product.description} version={product.image?.version} size={size} />;
}

/**
 * The thumbnail component shared by the grid, the list and the order lines (cart and summary). A line that does not
 * know the image version (a reopened draft) shows only what is already cached on the device (`peek`), never downloads.
 */
export function Thumb({ code, description, version, size }: { code: number; description: string; version?: string | undefined; size: "card" | "row" }) {
  const { store, online } = useProductImages();
  const key = `${code}|${version ?? ""}`;
  const [resolved, setResolved] = useState<{ readonly key: string; readonly uri: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (store === null) return undefined;
    const controller = new AbortController();
    const found = version === undefined ? (store.peek?.(code) ?? Promise.resolve(null)) : store.resolve(code, { version }, { online, signal: controller.signal });
    void found.then((uri) => {
      if (!controller.signal.aborted) setResolved(uri === null ? null : { key, uri });
    });
    return () => controller.abort();
  }, [store, online, code, version, key]);

  const uri = resolved !== null && resolved.key === key && failedKey !== key ? resolved.uri : null;
  const product = { code, description };
  const initials = product.description.trim().slice(0, 2).toUpperCase();
  return (
    <View style={[styles.thumb, size === "card" ? styles.thumbCard : styles.thumbRow]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri === null ? (
        <Text style={[styles.thumbText, size === "row" && styles.thumbTextRow]}>{initials}</Text>
      ) : (
        <Image source={{ uri }} style={styles.thumbImage} resizeMode="contain" onError={() => setFailedKey(key)} testID={`product-thumb-${product.code}`} />
      )}
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
        <Text style={styles.addText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2}>Adicionar</Text>
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
        <Text style={styles.stepText} maxFontSizeMultiplier={1.2}>−</Text>
      </Pressable>
      {actions.onSetQuantity !== undefined ? (
        <QuantityField
          value={quantity}
          productName={product.description}
          zeroRemoves
          compact
          onCommit={(result) => actions.onSetQuantity?.(product, result)}
        />
      ) : (
        <Text style={styles.qty} accessibilityLabel={`Quantidade no carrinho: ${quantity}`}>{quantity}</Text>
      )}
      <Pressable
        style={styles.step}
        onPress={() => actions.onAdd(product)}
        accessibilityRole="button"
        accessibilityLabel={`${product.description}, já no carrinho, adicionar outra unidade`}
      >
        <Text style={styles.stepText} maxFontSizeMultiplier={1.2}>+</Text>
      </Pressable>
    </View>
  );
}

interface ViewProps {
  /** Opens the product detail (tap on the card or row, outside the add control). */
  readonly onOpen?: ((product: ProductListItem) => void) | undefined;
  readonly product: ProductListItem;
  readonly quantity?: string | undefined;
  readonly actions?: ProductOrderActions | undefined;
}

function describe(product: ProductListItem, quantity: string | undefined): string {
  const parts = [product.description, `código ${product.code}`, product.unit, priceLabel(product)];
  if (quantity !== undefined) parts.push(`${quantity} no carrinho`);
  return parts.join(", ");
}

function CardImpl({ product, quantity, actions, onOpen }: ViewProps) {
  const noPrice = product.listPrice.state === "none";
  return (
    <Pressable style={styles.card} onPress={onOpen === undefined ? undefined : () => onOpen(product)} accessible={actions === undefined} accessibilityLabel={actions === undefined ? describe(product, quantity) : undefined}>
      <ProductThumb product={product} size="card" />
      <Text style={styles.cardName} numberOfLines={2}>{product.description}</Text>
      <Text style={styles.meta} numberOfLines={1}>{`Cód. ${product.code} · ${product.unit}`}</Text>
      <Text style={styles.group} numberOfLines={1}>{product.groupName ?? " "}</Text>
      <Text style={[styles.price, noPrice && styles.noPrice]}>{priceLabel(product)}</Text>
      {actions !== undefined && (
        <View style={styles.cardAction}>
          <AddControl product={product} quantity={quantity} actions={actions} />
        </View>
      )}
    </Pressable>
  );
}

function RowImpl({ product, quantity, actions, onOpen }: ViewProps) {
  const noPrice = product.listPrice.state === "none";
  return (
    <Pressable style={styles.row} onPress={onOpen === undefined ? undefined : () => onOpen(product)} accessible={actions === undefined} accessibilityLabel={actions === undefined ? describe(product, quantity) : undefined}>
      <ProductThumb product={product} size="row" />
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>{product.description}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`Código ${product.code} · ${product.unit}${product.groupName !== null ? ` · ${product.groupName}` : ""}`}</Text>
        <Text style={[styles.price, noPrice && styles.noPrice]}>{priceLabel(product)}</Text>
      </View>
      {actions !== undefined && (
        <View style={styles.rowAction}>
          <AddControl product={product} quantity={quantity} actions={actions} />
        </View>
      )}
      {actions === undefined && !product.sellable && <Text style={[styles.notSellable, styles.rowNotice]} numberOfLines={1}>Indisponível</Text>}
    </Pressable>
  );
}

// Memoized: a cart change re-renders only the cards whose quantity changed (the row object is stable per page).
export const ProductCard = memo(CardImpl);
export const ProductRow = memo(RowImpl);

const styles = StyleSheet.create({
  thumb: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbCard: { aspectRatio: 1, borderRadius: radius.md, alignSelf: "stretch" },
  thumbRow: { width: 48, height: 48, borderRadius: radius.md },
  thumbImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  thumbText: { fontSize: fontSize.title, fontWeight: "800", color: colors.textMuted },
  thumbTextRow: { fontSize: 16 },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, margin: spacing.xs, gap: 2 },
  cardName: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: spacing.xs, minHeight: 36 },
  cardAction: { marginTop: spacing.xs, alignItems: "stretch" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.xs + 2, gap: spacing.sm },
  rowInfo: { flex: 1, flexShrink: 1, minWidth: 0, gap: 1 },
  // Reserved action area: "Adicionar" and "- qty +" occupy the same width, so the quantity never pushes the text out.
  rowAction: { width: ROW_ACTION_WIDTH, flexShrink: 0, alignItems: "stretch", justifyContent: "center" },
  rowNotice: { flexShrink: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  group: { minHeight: 14, fontSize: 11, color: colors.textMuted, opacity: 0.85 },
  price: { fontSize: 15, fontWeight: "800", color: colors.navy },
  noPrice: { color: colors.textMuted, fontStyle: "italic", fontWeight: "600" },
  notSellable: { fontSize: 12, fontWeight: "700", color: colors.warning },
  add: { minHeight: control.height, minWidth: 0, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  addPressed: { opacity: 0.8 },
  addText: { color: colors.onNavy, fontWeight: "700", fontSize: 13 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", maxWidth: "100%", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, minHeight: 44, overflow: "hidden" },
  step: { width: 40, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: fontSize.title, fontWeight: "700", color: colors.navy },
  qty: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 15, fontWeight: "800", color: colors.text },
});
