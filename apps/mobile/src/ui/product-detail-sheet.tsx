import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ProductListItem } from "../data/ports";
import { describeListPrice } from "../lib/money";
import { colors, fontSize, spacing } from "../theme";
import { Sheet } from "./customer-filters";
import { Thumb } from "./product-views";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** Product detail (same fields as the site, never cost or margin): large photo, brand, reference, group and the origin of the list price. */
export function ProductDetailSheet({ product, onClose }: { product: ProductListItem | null; onClose: () => void }) {
  return (
    <Sheet visible={product !== null} onClose={onClose} title={product?.description ?? "Produto"}>
      {product !== null && (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.photo}>
            <Thumb code={product.code} description={product.description} version={product.image?.version} size="card" />
          </View>
          <Field label="Código" value={String(product.code)} />
          <Field label="Unidade" value={product.unit} />
          <Field label="Marca" value={product.brand ?? "—"} />
          <Field label="Referência" value={product.reference ?? "—"} />
          <Field label="Grupo" value={product.groupName ?? "—"} />
          <Field label="Preço de lista" value={describeListPrice(product.listPrice)} />
          <Field label="Origem do preço" value={product.listPrice.state === "none" ? "—" : `Tabela ${product.listPrice.tableCode}`} />
          <Field label="Venda" value={product.sellable ? "Disponível para venda" : "Indisponível para venda"} />
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.lg },
  photo: { alignSelf: "center", width: "70%", maxWidth: 280 },
  field: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { fontSize: 13, color: colors.textMuted },
  value: { flexShrink: 1, fontSize: fontSize.body, fontWeight: "700", color: colors.text, textAlign: "right" },
});
