import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  entryFailureMessages,
  identifiersToResolve,
  parseBulkEntry,
  planEntry,
  resolveIdentifiers,
  skipReasonMessages,
  type PlannedRow,
} from "../data/bulk-entry";
import { lineFromProduct, type EditorLine } from "../data/order-draft";
import type { ListPriceContext, ProductRepository } from "../data/ports";
import { colors, radius, spacing } from "../theme";
import { FormButton, FormFrame, formStyles } from "./customer-form-parts";

export interface BulkEntryScreenProps {
  readonly products: ProductRepository;
  readonly customerCode: number;
  /** Products already in the order: such a row is left out ("Produto já está no pedido"), never summed. */
  readonly existingCodes: ReadonlySet<number>;
  readonly isPriceOrderable: (state: ListPriceContext["state"]) => boolean;
  /** The lines to add (new keys come from `newKey`). */
  readonly onAdd: (lines: readonly EditorLine[]) => void;
  readonly onClose: () => void;
  readonly newKey: () => string;
  /** Label of the screen the user comes from. */
  readonly backLabel?: string;
}

type Review = { readonly planned: readonly PlannedRow[]; readonly skippedBeyondLimit: number };

/** The lines of a plan that will be added, with the typed quantity. */
export function linesOfPlan(planned: readonly PlannedRow[], newKey: () => string): EditorLine[] {
  const lines: EditorLine[] = [];
  for (const entry of planned) {
    if (entry.skip !== null || entry.product === null) continue;
    lines.push({ ...lineFromProduct(entry.product, newKey()), quantityText: entry.row.quantityText });
  }
  return lines;
}

/**
 * "Lançamento múltiplo": paste lines "código;quantidade" (code or reference, exact), review what each line does, add the valid ones.
 * Same format and reasons as the site; the catalog is the one on the device, so it also works offline. File import is not offered here.
 */
export function BulkEntryScreen({ products, customerCode, existingCodes, isPriceOrderable, onAdd, onClose, newKey, backLabel = "Pedido" }: BulkEntryScreenProps) {
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => {
      alive.current = false;
      subscription.remove();
    };
  }, [onClose]);

  const check = async () => {
    setProblem(null);
    const parsed = parseBulkEntry(text);
    if (!parsed.ok) {
      setProblem(entryFailureMessages[parsed.reason]);
      return;
    }
    setChecking(true);
    try {
      const resolutions = await resolveIdentifiers(products, customerCode, identifiersToResolve(parsed.rows));
      if (!alive.current) return;
      setReview({ planned: planEntry(parsed.rows, resolutions, { existingCodes, isPriceOrderable }), skippedBeyondLimit: parsed.skipped });
    } catch {
      if (alive.current) setProblem("Não foi possível conferir os produtos neste aparelho. Tente de novo.");
    } finally {
      if (alive.current) setChecking(false);
    }
  };

  const ready = review === null ? 0 : review.planned.filter((entry) => entry.skip === null).length;

  const add = () => {
    if (review === null || ready === 0) return;
    onAdd(linesOfPlan(review.planned, newKey));
  };

  return (
    <FormFrame
      title="Lançamento múltiplo"
      backLabel={backLabel}
      onCancel={onClose}
      footer={
        review === null ? (
          <>
            <FormButton label="Cancelar" onPress={onClose} />
            <FormButton label={checking ? "Conferindo…" : "Conferir"} primary onPress={() => void check()} disabled={checking || text.trim() === ""} />
          </>
        ) : (
          <>
            <FormButton label="Voltar ao texto" onPress={() => setReview(null)} />
            <FormButton label={ready === 1 ? "Adicionar 1 item" : `Adicionar ${ready} itens`} primary onPress={add} disabled={ready === 0} />
          </>
        )
      }
    >
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {review === null ? (
          <View style={formStyles.group}>
            <Text style={formStyles.groupTitle}>Linhas no formato código;quantidade</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(value) => {
                setText(value);
                setProblem(null);
              }}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              accessibilityLabel="Linhas do lançamento"
              placeholder={"1001;10\nREF-22;2,5"}
              placeholderTextColor={colors.textMuted}
            />
            {problem !== null && (
              <Text style={styles.error} accessibilityRole="alert">
                {problem}
              </Text>
            )}
            {checking && <ActivityIndicator color={colors.navy} accessibilityLabel="Conferindo" />}
          </View>
        ) : (
          <View style={formStyles.group}>
            <Text style={formStyles.groupTitle}>{`${ready} de ${review.planned.length} linhas serão adicionadas`}</Text>
            {review.skippedBeyondLimit > 0 && <Text style={styles.warning}>{`${review.skippedBeyondLimit} linhas além do limite de 500 por pedido ficaram de fora.`}</Text>}
            {review.planned.map((entry) => (
              <View key={`${entry.row.line}`} style={styles.row} accessible accessibilityLabel={`Linha ${entry.row.line}: ${entry.row.identifier}, ${entry.skip === null ? "será adicionada" : skipReasonMessages[entry.skip]}`}>
                <Text style={styles.rowTitle}>{entry.product !== null ? entry.product.description : entry.row.identifier}</Text>
                <Text style={styles.rowMeta}>{`Linha ${entry.row.line} · ${entry.row.identifier} · quantidade ${entry.row.quantityText}`}</Text>
                {entry.skip !== null && <Text style={styles.error}>{skipReasonMessages[entry.skip]}</Text>}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </FormFrame>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, fontSize: 15, color: colors.text, backgroundColor: colors.background },
  error: { color: colors.red, fontSize: 13, fontWeight: "600" },
  warning: { color: colors.textMuted, fontSize: 13 },
  row: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted },
});
