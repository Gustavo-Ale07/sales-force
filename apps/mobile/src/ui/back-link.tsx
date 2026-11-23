import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import { Icon } from "./icons";

/** "Back" row of an inner screen: a vector chevron plus the destination name (never a text glyph). */
export function BackLink({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable style={styles.back} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <View style={styles.row}>
        <Icon name="back" color={colors.navy} size={20} />
        <Text style={styles.text}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  text: { fontSize: 16, fontWeight: "700", color: colors.navy },
});
