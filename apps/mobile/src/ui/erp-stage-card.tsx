import { StyleSheet, Text, View } from "react-native";
import type { ErpStageView } from "../offline/erp-stage";
import { colors, spacing } from "../theme";
import { Icon } from "./icons";
import { formatDateTime } from "./sync-status";

const TONE_COLOR = { neutral: colors.textMuted, info: colors.navy, ok: colors.ok, warning: colors.warning, danger: colors.red } as const;

/** "dd/mm/aaaa hh:mm" of the last confirmation, in the device's pt-BR format. */
export function describeStageLine(stage: ErpStageView): string {
  const when = `atualizado em ${formatDateTime(stage.asOf)}`;
  return stage.kind === "force" ? `${stage.label} · ${when}` : `${stage.kind === "quotation" ? stage.label : `Situação no Sankhya: ${stage.label}`} · ${when}`;
}

/**
 * Where the order is in Sankhya: the server's last known stage (kept offline) with its timeline. Marks never rely on colour
 * alone: each step says "concluída", "etapa atual" or "próxima etapa" in its accessibility label and shows a check or a number.
 */
export function ErpStageCard({ stage }: { stage: ErpStageView }) {
  const color = TONE_COLOR[stage.tone];
  return (
    <View style={styles.box} accessibilityLabel={`Situação do pedido: ${describeStageLine(stage)}`}>
      <Text style={[styles.line, { color }]} accessibilityRole="header">{describeStageLine(stage)}</Text>
      {stage.kind === "timeline" && (
        <View accessibilityRole="list">
          {stage.steps.map((step, index) => {
            const state = step.state === "done" ? "concluída" : step.state === "current" ? "etapa atual" : "próxima etapa";
            const last = index === stage.steps.length - 1;
            return (
              <View key={step.code} style={styles.step} accessibilityLabel={`${step.label}, ${state}`}>
                <View style={styles.rail}>
                  <View style={[styles.dot, step.state === "done" && styles.dotDone, step.state === "current" && { backgroundColor: color, borderColor: color }]}>
                    {step.state === "done" ? <Icon name="check" color={colors.onNavy} size={14} /> : <Text style={[styles.dotText, step.state !== "todo" && styles.dotTextOn]}>{String(index + 1)}</Text>}
                  </View>
                  {!last && <View style={[styles.stem, step.state === "done" && styles.stemDone]} />}
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepLabel, step.state === "current" && styles.stepCurrent, step.state === "todo" && styles.stepTodo]}>{step.label}</Text>
                  {step.state === "current" && stage.pendingSector !== null && <Text style={styles.meta}>{`Pendente no setor: ${stage.pendingSector}`}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
      {stage.nunota !== null && <Text style={styles.meta}>{`${stage.kind === "quotation" ? "Orçamento" : "Pedido"} nº ${stage.nunota}`}</Text>}
      {stage.invoiceNumber !== null && <Text style={styles.meta}>{`Nota fiscal nº ${stage.invoiceNumber}`}</Text>}
    </View>
  );
}

const DOT = 24;
const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  line: { fontSize: 14, fontWeight: "700" },
  step: { flexDirection: "row", gap: spacing.sm, minHeight: 36 },
  rail: { alignItems: "center", width: DOT },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  dotDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  dotText: { fontSize: 12, fontWeight: "800", color: colors.textMuted },
  dotTextOn: { color: colors.onNavy },
  stem: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  stemDone: { backgroundColor: colors.ok },
  stepBody: { flex: 1, paddingBottom: spacing.sm, justifyContent: "flex-start" },
  stepLabel: { fontSize: 14, color: colors.text },
  stepCurrent: { fontWeight: "800" },
  stepTodo: { color: colors.textMuted },
  meta: { fontSize: 13, color: colors.textMuted },
});
