import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { isLinePriceOrderable, type EditorLine } from "../data/order-draft";
import {
  buildTemplateLines,
  describeTemplateError,
  templateSkipReasonLabels,
  type OrderTemplate,
  type OrderTemplatesPort,
  type SkippedTemplateLine,
} from "../data/order-templates";
import type { OrderRepository, ProductRepository } from "../data/ports";
import { colors, control, radius, spacing } from "../theme";
import { useAppModal } from "./app-modal";

export interface OrderTemplatesSectionProps {
  readonly customerCode: number;
  readonly templates: OrderTemplatesPort;
  readonly products: ProductRepository;
  readonly orders: Pick<OrderRepository, "getEntryConfiguration">;
  /** Bumped by the parent after a template was saved, to reload the list. */
  readonly reloadKey?: number;
  /** "Novo modelo": opens the form. */
  readonly onCreate: () => void;
  /** A new order for this customer with the template's lines (nothing is sent: it is saved like any other order). */
  readonly onUse: (lines: readonly EditorLine[], template: OrderTemplate, quotation: boolean) => void;
}

/** "Skipped lines" as the text list a dialog shows: one line per product left out, with the reason. */
export function skippedLinesText(skipped: readonly SkippedTemplateLine[]): string {
  return skipped.map((line) => `${line.description ?? `Produto ${line.productCode}`} (código ${line.productCode}): ${templateSkipReasonLabels[line.reason]}`).join("\n");
}

type ListState = { kind: "loading" } | { kind: "ready"; items: readonly OrderTemplate[] } | { kind: "error"; message: string };

/** "Pedidos recorrentes" of one customer on the customer sheet: use (new order), delete, new. Same function as the site. */
export function OrderTemplatesSection({ customerCode, templates, products, orders, reloadKey = 0, onCreate, onUse }: OrderTemplatesSectionProps) {
  const modal = useAppModal();
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    templates
      .list(customerCode)
      .then((items) => {
        if (current) setState({ kind: "ready", items });
      })
      .catch((error: unknown) => {
        if (current) setState({ kind: "error", message: describeTemplateError(error).message });
      });
    return () => {
      current = false;
    };
  }, [customerCode, templates, reloadKey, attempt]);

  const use = useCallback(
    async (template: OrderTemplate, quotation: boolean) => {
      setBusy(template.id);
      try {
        const [detail, config] = await Promise.all([templates.get(template.id), orders.getEntryConfiguration()]);
        const built = await buildTemplateLines(products, customerCode, detail.items, (price) => isLinePriceOrderable(price, config));
        if (built.lines.length === 0) {
          modal.show({
            variant: "error",
            title: "Nenhum item do modelo pode ser pedido agora",
            message: "Os produtos do modelo foram removidos, estão inativos, indisponíveis ou sem preço para este cliente. Nenhum pedido foi criado.",
            details: skippedLinesText(built.skipped),
            detailsLabel: "Ver itens",
            detailsPlain: true,
          });
          return;
        }
        if (built.skipped.length > 0) {
          modal.show({
            variant: "info",
            title: built.skipped.length === 1 ? "1 item ficou de fora" : `${built.skipped.length} itens ficaram de fora`,
            message: template.name,
            details: skippedLinesText(built.skipped),
            detailsLabel: "Ver itens",
            detailsPlain: true,
          });
        }
        onUse(built.lines, template, quotation);
      } catch (error) {
        modal.show({ variant: "error", title: "Não foi possível usar o modelo", message: describeTemplateError(error).message });
      } finally {
        setBusy(null);
      }
    },
    [templates, orders, products, customerCode, modal, onUse],
  );

  const remove = useCallback(
    async (template: OrderTemplate) => {
      const confirmed = await modal.confirm({
        variant: "confirm",
        title: "Apagar modelo recorrente?",
        message: `O modelo “${template.name}” será apagado. Pedidos já criados a partir dele não são afetados.`,
        confirmLabel: "Apagar",
        cancelLabel: "Manter modelo",
        destructive: true,
      });
      if (!confirmed) return;
      setBusy(template.id);
      try {
        await templates.remove(template.id);
        setAttempt((value) => value + 1);
      } catch (error) {
        modal.show({ variant: "error", title: "Não foi possível apagar o modelo", message: describeTemplateError(error).message });
        setAttempt((value) => value + 1);
      } finally {
        setBusy(null);
      }
    },
    [templates, modal],
  );

  return (
    <View style={styles.section} accessibilityLabel="Pedidos recorrentes">
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Pedidos recorrentes
        </Text>
        <Pressable style={styles.newButton} onPress={onCreate} accessibilityRole="button" accessibilityLabel="Novo pedido recorrente">
          <Text style={styles.newText}>Novo modelo</Text>
        </Pressable>
      </View>
      {state.kind === "loading" && <ActivityIndicator color={colors.navy} accessibilityLabel="Carregando pedidos recorrentes" />}
      {state.kind === "error" && (
        <View style={styles.row}>
          <Text style={styles.error} accessibilityRole="alert">
            {state.message}
          </Text>
          <Pressable style={styles.rowButton} onPress={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} accessibilityRole="button" accessibilityLabel="Tentar de novo">
            <Text style={styles.rowButtonText}>Tentar de novo</Text>
          </Pressable>
        </View>
      )}
      {state.kind === "ready" && state.items.length === 0 && <Text style={styles.empty}>Nenhum pedido recorrente para este cliente</Text>}
      {state.kind === "ready" &&
        state.items.map((template) => (
          <View key={template.id} style={styles.row}>
            <View style={styles.rowText} accessible accessibilityLabel={`${template.name}, ${template.itemCount} ${template.itemCount === 1 ? "item" : "itens"}`}>
              <Text style={styles.name}>{template.name}</Text>
              <Text style={styles.meta}>{`${template.itemCount} ${template.itemCount === 1 ? "item" : "itens"}`}</Text>
            </View>
            {busy === template.id ? (
              <ActivityIndicator color={colors.navy} />
            ) : (
              <View style={styles.actions}>
                <Pressable style={styles.rowButton} disabled={busy !== null} onPress={() => void use(template, true)} accessibilityRole="button" accessibilityLabel={`Criar orçamento do modelo ${template.name}`}>
                  <Text style={styles.rowButtonText}>Orçamento</Text>
                </Pressable>
                <Pressable style={[styles.rowButton, styles.useButton]} disabled={busy !== null} onPress={() => void use(template, false)} accessibilityRole="button" accessibilityLabel={`Usar modelo ${template.name}`}>
                  <Text style={styles.useText}>Usar</Text>
                </Pressable>
                <Pressable style={styles.rowButton} disabled={busy !== null} onPress={() => void remove(template)} accessibilityRole="button" accessibilityLabel={`Apagar modelo ${template.name}`}>
                  <Text style={styles.rowButtonText}>Apagar</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontSize: 14, fontWeight: "800", color: colors.navy, flexShrink: 1 },
  newButton: { minHeight: control.height, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  newText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: "row", gap: spacing.sm },
  rowButton: { minHeight: control.height, minWidth: control.height, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  rowButtonText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  useButton: { backgroundColor: colors.navy },
  useText: { color: colors.onNavy, fontWeight: "700", fontSize: 14 },
  empty: { fontSize: 14, color: colors.textMuted },
  error: { flex: 1, fontSize: 14, color: colors.red, fontWeight: "600" },
});
