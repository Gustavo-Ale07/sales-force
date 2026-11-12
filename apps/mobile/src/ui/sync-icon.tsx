import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import type { SyncTone } from "../offline/sync-status-text";

/** Follows the system "reduce motion" setting (Android: animation scale off). Defaults to false until known. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (active) setReduce(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduce);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduce;
}

/**
 * Sync state icon, same idea as the site (spinner while it works, calm when done, alert on failure), drawn with
 * plain views: a ring that spins while syncing, a check when up to date, "!" on failure. No SVG, no animation
 * library; the spin is skipped (static ring) when the system asks to reduce motion.
 */
export function SyncIcon({ tone, syncing, color, size = 16 }: { tone: SyncTone; syncing: boolean; color: string; size?: number }) {
  const reduceMotion = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(0));
  const spin = syncing && !reduceMotion;

  useEffect(() => {
    if (!spin) {
      turn.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, turn]);

  const box = { width: size, height: size, borderRadius: size / 2 };
  if (syncing) {
    const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
    return (
      <Animated.View
        testID="sync-icon-spinner"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[box, styles.ring, { borderColor: color, borderTopColor: "transparent", transform: [{ rotate }] }]}
      />
    );
  }
  const glyph = tone === "error" ? "!" : tone === "ok" ? "✓" : null;
  return (
    <View
      testID={`sync-icon-${tone}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[box, styles.center, glyph === null ? { backgroundColor: color } : { borderColor: color, borderWidth: 1.5 }]}
    >
      {glyph !== null && <Text style={[styles.glyph, { color, fontSize: size * 0.7, lineHeight: size * 0.95 }]}>{glyph}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 2 },
  center: { alignItems: "center", justifyContent: "center" },
  glyph: { fontWeight: "800", textAlign: "center", includeFontPadding: false },
});
