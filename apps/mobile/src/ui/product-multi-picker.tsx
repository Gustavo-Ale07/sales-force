import { Pressable, StyleSheet, Text } from "react-native";
import type { ProductListItem, ProductPageRequest, ProductRepository } from "../data/ports";
import { colors, radius, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";

export interface PickedProduct {
  readonly code: number;
  readonly name: string;
}

/** Multi-select of local products for the sales filter (at most `max`); the site's product filter, offline. */
export function ProductMultiPicker({
  products,
  selected,
  max,
  onChange,
  onUnauthenticated,
}: {
  products: ProductRepository;
  selected: readonly PickedProduct[];
  max: number;
  onChange: (next: PickedProduct[]) => void;
  onUnauthenticated: () => void;
}) {
  const isSelected = (code: number) => selected.some((product) => product.code === code);
  const toggle = (product: ProductListItem) => {
    if (isSelected(product.code)) onChange(selected.filter((item) => item.code !== product.code));
    else if (selected.length < max) onChange([...selected, { code: product.code, name: product.description }]);
  };
  return (
    <>
      <Text style={styles.count}>{`${selected.length} de ${max} selecionados`}</Text>
      <PagedListView<ProductListItem, ProductPageRequest>
        load={(request) => products.list(request)}
        keyOf={(product) => String(product.code)}
        extraData={selected}
        renderItem={(product) => {
          const on = isSelected(product.code);
          const full = !on && selected.length >= max;
          return (
            <Pressable
              style={[styles.row, on && styles.rowOn, full && styles.rowOff]}
              onPress={() => toggle(product)}
              disabled={full}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: full }}
              accessibilityLabel={`${product.description}, código ${product.code}`}
            >
              <Text style={[styles.name, on && styles.nameOn]}>{product.description}</Text>
              <Text style={[styles.meta, on && styles.nameOn]}>{`Código ${product.code}`}</Text>
            </Pressable>
          );
        }}
        searchLabel="Buscar produto por descrição ou código"
        emptyText="Nenhum produto disponível"
        onUnauthenticated={onUnauthenticated}
      />
    </>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 13, color: colors.textMuted },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
  rowOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  rowOff: { opacity: 0.5 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  nameOn: { color: colors.onNavy },
  meta: { fontSize: 13, color: colors.textMuted },
});
