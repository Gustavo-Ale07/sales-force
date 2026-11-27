import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, control, radius, spacing } from "../theme";

export interface PriceTableChoice {
  readonly code: number;
  readonly name: string;
}

export interface PriceTablePickerProps {
  readonly tables: readonly PriceTableChoice[];
  /** The chosen table, marked in the list. `null` = none yet. */
  readonly selectedCode: number | null;
  readonly onSelect: (code: number) => void;
  readonly error?: string | null;
}

/** "Tabela de preço": the few tables a customer may be given, by name; one tap chooses. Drawn inline inside the screen's own ScrollView. */
export function PriceTablePicker({ tables, selectedCode, onSelect, error }: PriceTablePickerProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Tabela de preço</Text>
      <View style={styles.list}>
        {tables.map((table) => {
          const on = table.code === selectedCode;
          return (
            <Pressable
              key={table.code}
              style={[styles.row, on && styles.rowOn]}
              onPress={() => onSelect(table.code)}
              accessibilityRole="radio"
              accessibilityLabel={`Tabela de preço ${table.name}`}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{table.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  label: { fontSize: 12, color: colors.textMuted },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  row: { minHeight: control.height, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  rowText: { fontSize: 15, fontWeight: "600", color: colors.navy },
  rowTextOn: { color: colors.onNavy },
  error: { fontSize: 12, color: colors.red, fontWeight: "600" },
});
