import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import type { SyncStatus, SyncStep } from "@salesforce/mobile-db";
import { currentStepText, failureCode, overallFraction, sellerSteps, type SellerStep } from "../offline/sync-steps-text";
import { colors, spacing } from "../theme";
import { Icon } from "./icons";
import { SyncIcon, useReduceMotion } from "./sync-icon";
import { useErrorPopup } from "./use-error-popup";
import { useInsets } from "./use-insets";

/** How long "Pronto" stays on screen before the screen closes by itself. */
const SUCCESS_HOLD_MS = 1000;
/** Bright green that reads on the navy background (the app's `ok` green is too dark for it). */
const CHECK_GREEN = "#3ecf7a";

/** Finished step = green check, current = spinner, next = dimmed ring. Never color only: the row label carries the state too. */
function StepMark({ state, reduceMotion }: { state: SellerStep["state"]; reduceMotion: boolean }) {
  const [scale] = useState(() => new Animated.Value(state === "done" ? 1 : 0));
  useEffect(() => {
    if (state !== "done") {
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
  if (state === "running") return <SyncIcon tone="busy" syncing color={colors.onNavy} size={22} />;
  if (state === "pending") return <View style={[styles.mark, styles.markPending]} />;
  return (
    <Animated.View style={[styles.mark, styles.markDone, { transform: [{ scale }] }]} testID="sync-step-check">
      <Icon name="check" color={colors.navy} size={16} />
    </Animated.View>
  );
}

const STATE_TEXT: Readonly<Record<SellerStep["state"], string>> = { pending: "aguardando", running: "em andamento", done: "concluído" };

function StepRow({ step, reduceMotion }: { step: SellerStep; reduceMotion: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${step.label}: ${STATE_TEXT[step.state]}`} testID={`sync-step-${step.id}`}>
      <StepMark state={step.state} reduceMotion={reduceMotion} />
      <Text style={[styles.rowLabel, step.state === "pending" && styles.rowLabelPending, step.state === "running" && styles.rowLabelCurrent]} numberOfLines={1}>
        {step.label}
      </Text>
    </View>
  );
}

/** One overall bar that follows the pipeline's real progress (no timer). */
function OverallBar({ fraction, reduceMotion, label }: { fraction: number; reduceMotion: boolean; label: string }) {
  const [width, setWidth] = useState(0);
  const [fill] = useState(() => new Animated.Value(fraction));
  useEffect(() => {
    if (reduceMotion) fill.setValue(fraction);
    else Animated.timing(fill, { toValue: fraction, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [fraction, reduceMotion, fill]);
  return (
    <View
      style={styles.track}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      testID="sync-overall-bar"
    >
      <Animated.View style={[styles.fill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]} />
    </View>
  );
}

export interface SyncProgressOverlayProps {
  readonly status: SyncStatus;
  /** Runs the full sync again (the popup's "Tentar de novo"). */
  readonly onRetry: () => void;
  /** Stops the run before the local base is swapped (the previous base stays). Absent = no cancel button. */
  readonly onCancel?: () => void;
}

/**
 * Full-screen progress of the FULL sync (login and "Sincronizar"), in the navy of the login hero. Every value comes from the sync
 * pipeline's own step events; nothing here is a timer. On success it says "Pronto" and closes; on failure it closes and the app's
 * error popup explains the cause (the previous base stays on the device, which the popup says).
 */
export function SyncProgressOverlay({ status, onRetry, onCancel }: SyncProgressOverlayProps) {
  const reduceMotion = useReduceMotion();
  const errors = useErrorPopup();
  const insets = useInsets();
  // A run already finished when this screen mounted is not shown again.
  const [dismissed, setDismissed] = useState<readonly SyncStep[] | null>(() => status.steps ?? null);
  const ran = useRef(false);
  const handled = useRef<readonly SyncStep[] | null>(null);
  const shown = status.steps ?? null;
  const running = status.phase === "syncing" && shown !== null;
  const failed = !running && status.failure !== null && status.failure !== undefined;
  const failedPhase = status.phase === "error" || status.phase === "offline" || status.phase === "auth_required";
  const visible = shown !== null && shown !== dismissed && (running || !(failed || failedPhase));
  const done = visible && !running;

  const retry = useCallback(() => onRetry(), [onRetry]);

  useEffect(() => {
    if (running) ran.current = true;
  }, [running]);

  // Success: "Pronto" for a moment, then close.
  useEffect(() => {
    if (!done || shown === null) return undefined;
    const timer = setTimeout(() => setDismissed(shown), SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [done, shown]);

  // The run ended: announce it; a failure closes the screen and the app's popup explains the cause.
  useEffect(() => {
    if (running || shown === null || !ran.current || handled.current === shown) return;
    handled.current = shown;
    ran.current = false;
    if (!failed && !failedPhase) {
      AccessibilityInfo.announceForAccessibility?.("Sincronização concluída.");
      return;
    }
    AccessibilityInfo.announceForAccessibility?.("A sincronização não terminou.");
    errors.reportCode(failureCode(status.failure), { retry }, status.lastError ?? undefined);
  }, [running, shown, failed, failedPhase, status.failure, status.lastError, errors, retry]);

  if (!visible || shown === null) return null;
  const list = sellerSteps(shown);
  const fraction = done ? 1 : overallFraction(shown);
  return (
    <Modal visible transparent={false} animationType={reduceMotion ? "none" : "fade"} statusBarTranslucent navigationBarTranslucent onRequestClose={() => undefined}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} accessibilityViewIsModal testID="sync-screen">
        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {done ? "Pronto" : "Sincronizando"}
          </Text>
          <OverallBar fraction={fraction} reduceMotion={reduceMotion} label={done ? "Sincronização pronta" : `Sincronizando. ${currentStepText(shown)}`} />
          <View style={styles.list}>
            {list.map((step) => (
              <StepRow key={step.id} step={done ? { ...step, state: "done" } : step} reduceMotion={reduceMotion} />
            ))}
          </View>
        </View>
        {/* Only when a previous base exists: cancelling the very first download would leave the app empty. */}
        {running && onCancel !== undefined && status.lastSyncedAt !== null && (
          <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancelar sincronização" testID="sync-cancel">
            <Text style={styles.cancelText}>Cancelar sincronização</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy, paddingHorizontal: spacing.xl, justifyContent: "space-between" },
  body: { flex: 1, justifyContent: "center", gap: spacing.xl },
  title: { fontSize: 26, fontWeight: "800", color: colors.onNavy },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.onNavy },
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  rowLabel: { flexShrink: 1, fontSize: 17, fontWeight: "600", color: colors.onNavy },
  rowLabelCurrent: { fontWeight: "800" },
  rowLabelPending: { opacity: 0.5, fontWeight: "500" },
  mark: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  markPending: { borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  markDone: { backgroundColor: CHECK_GREEN },
  cancel: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.6)" },
  cancelText: { color: colors.onNavy, fontSize: 15, fontWeight: "700" },
});
