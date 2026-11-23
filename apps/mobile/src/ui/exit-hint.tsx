import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";

/** The "tap again to exit" hint of the home screen: a small bar over the bottom of the screen, announced to screen readers, never a native alert. */
export function ExitHint({ bottom }: { bottom: number }) {
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
      <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.text}>Toque de novo para sair</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.lg },
  bar: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  text: { color: colors.onNavy, fontSize: 14, fontWeight: "600" },
});
