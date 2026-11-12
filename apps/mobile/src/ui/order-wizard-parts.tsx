import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, spacing } from "../theme";

export const WIZARD_STEPS = ["customer", "negotiation", "products", "summary"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_LABEL: Record<WizardStep, string> = {
  customer: "Cliente",
  negotiation: "Negociação",
  products: "Produtos",
  summary: "Resumo",
};

/** "Etapa 2 de 4 · Negociação" plus a thin bar: one short line, nothing else on screen. */
export function WizardProgress({
  step,
  customerName,
  onExit,
}: {
  readonly step: WizardStep;
  readonly customerName?: string | undefined;
  /** When given, shows an exit control (the caller confirms before leaving). */
  readonly onExit?: (() => void) | undefined;
}) {
  const index = WIZARD_STEPS.indexOf(step) + 1;
  return (
    <View style={styles.progress}>
      <View
        style={styles.progressText}
        accessibilityRole="progressbar"
        accessibilityLabel={`Etapa ${index} de ${WIZARD_STEPS.length}: ${WIZARD_STEP_LABEL[step]}`}
        accessibilityValue={{ min: 1, max: WIZARD_STEPS.length, now: index }}
      >
        <Text style={styles.progressTitle} numberOfLines={1}>
          {WIZARD_STEP_LABEL[step]}
        </Text>
        <Text style={styles.progressStep}>{`${index} de ${WIZARD_STEPS.length}`}</Text>
      </View>
      {onExit !== undefined && (
        <Pressable style={styles.exit} onPress={onExit} accessibilityRole="button" accessibilityLabel="Sair do pedido">
          <Text style={styles.exitText}>✕</Text>
        </Pressable>
      )}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(index / WIZARD_STEPS.length) * 100}%` }]} />
      </View>
      {customerName !== undefined && (
        <Text style={styles.progressAside} numberOfLines={1}>
          {customerName}
        </Text>
      )}
    </View>
  );
}

export interface WizardFooterProps {
  readonly onBack: (() => void) | null;
  readonly onNext: () => void;
  readonly nextLabel: string;
  readonly nextAccessibilityLabel?: string;
  readonly nextDisabled?: boolean;
  readonly busy?: boolean;
  /** One short line (e.g. "3 itens · R$ 120,00") shown between the buttons; never a panel. */
  readonly info?: string | undefined;
}

/** Compact one-line navigation (about 52 dp): Voltar · [info] · Avançar. */
export function WizardFooter({ onBack, onNext, nextLabel, nextAccessibilityLabel, nextDisabled = false, busy = false, info }: WizardFooterProps) {
  return (
    <View style={styles.footer}>
      {onBack !== null ? (
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={styles.backText}>Voltar</Text>
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      {info !== undefined && (
        <Text style={styles.info} numberOfLines={1}>
          {info}
        </Text>
      )}
      <Pressable
        style={[styles.next, nextDisabled && styles.nextDisabled]}
        onPress={onNext}
        disabled={nextDisabled}
        accessibilityRole="button"
        accessibilityLabel={nextAccessibilityLabel ?? nextLabel}
        accessibilityState={{ disabled: nextDisabled }}
      >
        {busy ? <ActivityIndicator color={colors.onNavy} /> : <Text style={styles.nextText}>{nextLabel}</Text>}
      </Pressable>
    </View>
  );
}

/** A titled block of the order summary with an "Editar" shortcut back to the step that owns it. */
export function SummaryBlock({ title, onEdit, editLabel, children }: { readonly title: string; readonly onEdit?: (() => void) | undefined; readonly editLabel: string; readonly children: ReactNode }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.blockTitle}>{title}</Text>
        {onEdit !== undefined && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={editLabel}>
            <Text style={styles.edit}>Editar</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export function SummaryRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export const NOTES_MAX = 2000;

/** Free-text order notes (existing `notes` field, max 2000). */
export function NotesField({ value, onChange }: { readonly value: string; readonly onChange: (text: string) => void }) {
  return (
    <View style={styles.notesBox}>
      <Text style={styles.notesCaption}>Observações (opcional)</Text>
      <TextInput
        style={styles.notesInput}
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={NOTES_MAX}
        textAlignVertical="top"
        placeholder="Observações do pedido"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Observações do pedido"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  progressText: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, paddingRight: 48 },
  progressTitle: { fontSize: 16, fontWeight: "800", color: colors.navy, flexShrink: 1 },
  progressStep: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  progressAside: { fontSize: 12, color: colors.textMuted, paddingBottom: spacing.xs },
  exit: { position: "absolute", top: 0, right: spacing.xs, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  exitText: { fontSize: 18, color: colors.textMuted, fontWeight: "700" },
  track: { height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden", marginBottom: spacing.xs },
  fill: { height: 3, backgroundColor: colors.navy },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: { minWidth: 72, minHeight: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  info: { flex: 1, fontSize: 12, color: colors.textMuted, textAlign: "center" },
  next: { flexGrow: 1, flexBasis: 0, minHeight: 44, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  nextDisabled: { opacity: 0.5 },
  nextText: { color: colors.onNavy, fontSize: 15, fontWeight: "700" },
  block: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  blockHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  blockTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  edit: { color: colors.navy, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13, color: colors.text, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  notesBox: { margin: spacing.md, marginTop: 0, padding: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  notesCaption: { fontSize: 12, color: colors.textMuted },
  notesInput: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: spacing.sm, fontSize: 16, color: colors.text, backgroundColor: colors.background },
});
