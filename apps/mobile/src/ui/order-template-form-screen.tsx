import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { EditorLine } from "../data/order-draft";
import {
  describeTemplateError,
  isUnknownTemplateOutcome,
  templateItemsOf,
  type OrderTemplatesPort,
} from "../data/order-templates";
import type { OrderRepository, ProductRepository } from "../data/ports";
import { addProductLine, decrementProductLine, hasTemplateFormProblems, setProductLineQuantity, templateFormProblems } from "../data/template-form";
import { newClientRequestId } from "../lib/uuid";
import { datasetIdentityOf } from "../offline/reference-source";
import { colors, radius, spacing } from "../theme";
import { Banner, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";
import { ProductPicker } from "./product-picker";
import { QuantityField } from "./quantity-field";

export interface OrderTemplateFormScreenProps {
  readonly customerCode: number;
  readonly customerName: string;
  readonly templates: OrderTemplatesPort;
  readonly products: ProductRepository;
  readonly orders: Pick<OrderRepository, "getEntryConfiguration">;
  readonly onUnauthenticated: () => void;
  /** The template was saved. */
  readonly onSaved: () => void;
  readonly onClose: () => void;
  /** Id source, injectable for tests. */
  readonly newId?: () => string;
}

/**
 * "Novo pedido recorrente": a name and a list of product + quantity for one customer (same function as the site). Online only.
 * The request id is kept after a lost answer (the server answers a repeat with the saved template) and replaced when the form changes.
 */
export function OrderTemplateFormScreen({ customerCode, customerName, templates, products, orders, onUnauthenticated, onSaved, onClose, newId = newClientRequestId }: OrderTemplateFormScreenProps) {
  const [name, setName] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [picking, setPicking] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; nameTaken: boolean } | null>(null);
  const requestId = useRef<string | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picking) setPicking(false);
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [picking, onClose]);

  const changeLines = (update: (current: EditorLine[]) => EditorLine[]) => {
    requestId.current = null;
    setLines(update);
  };
  const problems = templateFormProblems(name, lines);

  const submit = async () => {
    if (sending) return;
    setShowProblems(true);
    if (hasTemplateFormProblems(problems)) return;
    const items = templateItemsOf(lines);
    if (items === null) return;
    setSending(true);
    setFailure(null);
    try {
      const expectedDataset = datasetIdentityOf(await orders.getEntryConfiguration());
      if (expectedDataset === null) {
        setFailure({ message: "Os dados deste aparelho ainda não foram confirmados pelo servidor. Sincronize e tente de novo.", nameTaken: false });
        return;
      }
      requestId.current ??= newId();
      await templates.create(customerCode, { clientRequestId: requestId.current, expectedDataset, name: name.trim(), items });
      requestId.current = null;
      onSaved();
    } catch (error) {
      const described = describeTemplateError(error);
      if (!isUnknownTemplateOutcome(error)) requestId.current = null;
      setFailure({ message: described.message, nameTaken: described.reason === "name_taken" });
    } finally {
      setSending(false);
    }
  };

  if (picking) {
    return (
      <View style={styles.picker}>
        <View style={styles.pickerBar}>
          <Text style={styles.pickerTitle} accessibilityRole="header">
            {`Produtos do modelo (${lines.length})`}
          </Text>
          <FormButton label="Concluir" primary onPress={() => setPicking(false)} />
        </View>
        <ProductPicker
          products={products}
          customerCode={customerCode}
          onUnauthenticated={onUnauthenticated}
          actions={{
            quantityOf: (code) => lines.find((line) => line.productCode === code)?.quantityText,
            onAdd: (product) => changeLines((current) => addProductLine(current, product, `f-${(counter.current += 1)}`)),
            onDecrement: (product) => changeLines((current) => decrementProductLine(current, product)),
            onSetQuantity: (product, result) => changeLines((current) => setProductLineQuantity(current, product, result)),
          }}
        />
      </View>
    );
  }

  return (
    <FormFrame
      title="Novo pedido recorrente"
      backLabel="Cliente"
      onCancel={onClose}
      footer={
        <>
          <FormButton label="Cancelar" onPress={onClose} disabled={sending} />
          <FormButton label={sending ? "Salvando…" : "Salvar modelo"} primary onPress={() => void submit()} disabled={sending} />
        </>
      }
    >
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.customer}>{customerName}</Text>
        {failure !== null && <Banner text={failure.message} />}
        <View style={formStyles.group}>
          <FormField
            label="Nome do modelo"
            required
            value={name}
            onChangeText={(text) => {
              requestId.current = null;
              setName(text);
            }}
            maxLength={80}
            error={showProblems ? problems.name : failure?.nameTaken === true ? failure.message : null}
          />
        </View>
        <View style={formStyles.group}>
          <Text style={formStyles.groupTitle}>{`Itens (${lines.length})`}</Text>
          {showProblems && problems.lines !== null && <Text style={styles.error}>{problems.lines}</Text>}
          {lines.map((line) => (
            <View key={line.key} style={styles.line}>
              <View style={styles.lineText}>
                <Text style={styles.lineName}>{line.description}</Text>
                <Text style={styles.lineMeta}>{`Código ${line.productCode} · ${line.unit}`}</Text>
              </View>
              <View style={styles.qty}>
                <QuantityField
                  value={line.quantityText}
                  productName={line.description}
                  zeroRemoves
                  onCommit={(result) => changeLines((current) => setProductLineQuantity(current, { code: line.productCode }, result))}
                />
              </View>
              <Pressable
                style={styles.removeButton}
                onPress={() => changeLines((current) => current.filter((item) => item.key !== line.key))}
                accessibilityRole="button"
                accessibilityLabel={`Remover ${line.description}`}
              >
                <Text style={styles.removeText}>Remover</Text>
              </Pressable>
            </View>
          ))}
          <FormButton label="Adicionar produtos" onPress={() => setPicking(true)} disabled={sending} />
        </View>
      </ScrollView>
    </FormFrame>
  );
}

const styles = StyleSheet.create({
  customer: { fontSize: 14, color: colors.textMuted },
  error: { color: colors.red, fontSize: 13, fontWeight: "600" },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  lineText: { flex: 2, gap: 2 },
  lineName: { fontSize: 14, fontWeight: "700", color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted },
  qty: { flex: 1, minWidth: 80 },
  removeButton: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center", borderRadius: radius.md },
  removeText: { color: colors.red, fontWeight: "700", fontSize: 13 },
  picker: { flex: 1, backgroundColor: colors.background },
  pickerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, gap: spacing.sm },
  pickerTitle: { fontSize: 16, fontWeight: "800", color: colors.navy, flexShrink: 1 },
});
