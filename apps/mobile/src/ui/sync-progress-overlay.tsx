import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, StyleSheet, Text, View } from "react-native";
import type { SyncStatus, SyncStep } from "@salesforce/mobile-db";
import { failureCode, overallText, STEP_LABEL, stepAccessibilityLabel, stepCountText, stepFraction } from "../offline/sync-steps-text";
import { colors, spacing } from "../theme";
import { SyncIcon, useReduceMotion } from "./sync-icon";
import { useErrorPopup } from "./use-error-popup";

/** How long the finished list stays on screen before it closes by itself. */
const SUCCESS_HOLD_MS = 1600;

/** Animated check: pops in when the step finishes (no animation when the system asks to reduce motion). */
function StepMark({ state, reduceMotion }: { state: SyncStep["state"]; reduceMotion: boolean }) {
  const [scale] = useState(() => new Animated.Value(state === "done" || state === "error" ? 1 : 0));
  useEffect(() => {
    if (state !== "done" && state !== "error") {
      scale.setValue(0);
      return;
    }
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [state, reduceMotion, scale]);
  if (state === "running") return <SyncIcon tone="busy" syncing color={colors.navy} size={18} />;
  if (state === "pending") return <View style={[styles.mark, styles.markPending]} />;
  const failed = state === "error";
  return (
    <Animated.View style={[styles.mark, failed ? styles.markError : styles.markDone, { transform: [{ scale }] }]} testID={failed ? "sync-step-error" : "sync-step-check"}>
      <Text style={styles.markGlyph}>{failed ? "!" : "✓"}</Text>
    </Animated.View>
  );
}

/** Bar that follows the real fraction; indeterminate steps get a sliding segment (a plain bar under reduced motion). */
function StepBar({ step, reduceMotion }: { step: SyncStep; reduceMotion: boolean }) {
  const fraction = stepFraction(step);
  const [width, setWidth] = useState(0);
  const [fill] = useState(() => new Animated.Value(fraction ?? 0));
  const [slide] = useState(() => new Animated.Value(0));
  const indeterminate = step.state === "running" && fraction === null;

  useEffect(() => {
    const target = fraction ?? 0;
    if (reduceMotion) fill.setValue(target);
    else Animated.timing(fill, { toValue: target, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [fraction, reduceMotion, fill]);

  useEffect(() => {
    if (!indeterminate || reduceMotion) {
      slide.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(slide, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [indeterminate, reduceMotion, slide]);

  const segment = Math.max(24, width * 0.3);
  return (
    <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {indeterminate ? (
        <Animated.View
          style={[styles.fill, { width: reduceMotion ? width : segment, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }], opacity: reduceMotion ? 0.35 : 1 }]}
        />
      ) : (
        <Animated.View
          style={[styles.fill, step.state === "error" && styles.fillError, { width: fill.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]}
        />
      )}
    </View>
  );
}

function StepRow({ step, reduceMotion }: { step: SyncStep; reduceMotion: boolean }) {
  const count = stepCountText(step);
  return (
    <View style={styles.row} accessible accessibilityLabel={stepAccessibilityLabel(step)} testID={`sync-step-${step.id}`}>
      <StepMark state={step.state} reduceMotion={reduceMotion} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowLabel, step.state === "pending" && styles.rowLabelPending]} numberOfLines={1}>
            {STEP_LABEL[step.id]}
          </Text>
          {count !== "" && (
            <Text style={[styles.rowCount, step.state === "error" && styles.rowCountError]} numberOfLines={1}>
              {count}
            </Text>
          )}
        </View>
        {(step.state === "running" || step.state === "done") && <StepBar step={step} reduceMotion={reduceMotion} />}
      </View>
    </View>
  );
}

export interface SyncProgressOverlayProps {
  readonly status: SyncStatus;
  /** Runs the full sync again (the popup's "Tentar de novo"). */
  readonly onRetry: () => void;
}

/**
 * Full-screen progress of the FULL sync (login and "Sincronizar"). Every number comes from the sync pipeline's own step
 * events; nothing here is a timer. On success the finished list shows for a moment and closes; on failure it closes and the
 * app's error popup explains the cause (the previous base stays on the device, which the popup says).
 */
export function SyncProgressOverlay({ status, onRetry }: SyncProgressOverlayProps) {
  const reduceMotion = useReduceMotion();
  const errors = useErrorPopup();
  // A run already finished when this screen mounted is not shown again.
  const [dismissed, setDismissed] = useState<readonly SyncStep[] | null>(() => status.steps ?? null);
  const ran = useRef(false);
  const handled = useRef<readonly SyncStep[] | null>(null);
  const shown = status.steps ?? null;
  const running = status.phase === "syncing" && shown !== null;
  const failed = !running && status.failure !== null && status.failure !== undefined;
  const visible = shown !== null && shown !== dismissed && (running || !failed);
  const done = visible && !running;

  const retry = useCallback(() => onRetry(), [onRetry]);

  useEffect(() => {
    if (running) ran.current = true;
  }, [running]);

  // Success: hold the finished list for a moment, then close.
  useEffect(() => {
    if (!done || shown === null) return undefined;
    const timer = setTimeout(() => setDismissed(shown), SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [done, shown]);

  // The run ended: announce it; a failure closes the overlay and the app's popup explains the cause.
  useEffect(() => {
    if (running || shown === null || !ran.current || handled.current === shown) return;
    handled.current = shown;
    ran.current = false;
    if (!failed) {
      AccessibilityInfo.announceForAccessibility?.("Sincronização concluída. Dados atualizados.");
      return;
    }
    AccessibilityInfo.announceForAccessibility?.("A sincronização não terminou.");
    errors.reportCode(failureCode(status.failure), { retry }, status.lastError ?? undefined);
  }, [running, shown, failed, status.failure, status.lastError, errors, retry]);

  if (!visible || shown === null) return null;
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "fade"} statusBarTranslucent navigationBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.head}>
            {done ? <StepMark state="done" reduceMotion={reduceMotion} /> : <SyncIcon tone="busy" syncing color={colors.navy} size={22} />}
            <View style={styles.headText}>
              <Text style={styles.title} accessibilityRole="header">
                {done ? "Dados atualizados" : "Sincronizando"}
              </Text>
              <Text style={styles.subtitle} accessibilityLiveRegion="polite">
                {done ? "Tudo pronto para trabalhar." : `${overallText(shown)} · não feche o aplicativo`}
              </Text>
            </View>
          </View>
          <View style={styles.list}>
            {shown.map((step) => (
              <StepRow key={step.id} step={step} reduceMotion={reduceMotion} />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, gap: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted },
  list: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, minHeight: 36 },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  rowLabel: { flexShrink: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  rowLabelPending: { color: colors.textMuted, fontWeight: "500" },
  rowCount: { fontSize: 12, color: colors.textMuted, flexShrink: 1, textAlign: "right" },
  rowCountError: { color: colors.warning },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.navy },
  fillError: { backgroundColor: colors.red },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  markPending: { borderWidth: 2, borderColor: colors.border },
  markDone: { backgroundColor: colors.ok },
  markError: { backgroundColor: colors.red },
  markGlyph: { color: colors.onNavy, fontSize: 12, fontWeight: "800" },
});
