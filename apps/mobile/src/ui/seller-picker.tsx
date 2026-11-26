import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { SellerChoice } from "../data/customer-form";
import { filterSellers } from "../data/seller-search";
import { colors, control, radius, spacing } from "../theme";
import { Icon } from "./icons";

export interface SellerPickerProps {
  readonly sellers: readonly SellerChoice[];
  /** The chosen seller, marked in the list. `null` = none yet. */
  readonly selectedCode: number | null;
  readonly onSelect: (code: number) => void;
  readonly error?: string | null;
}

/**
 * "Vendedor": search box with a magnifier plus the matching sellers, alphabetical, one tap chooses. The list is drawn inline (no scroll
 * of its own), so it always lives inside the screen's own ScrollView and the whole screen scrolls, keyboard open included.
 * The parent ScrollView must set `keyboardShouldPersistTaps="handled"` so a tap on a row works while the keyboard is up.
 */
export function SellerPicker({ sellers, selectedCode, onSelect, error }: SellerPickerProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterSellers(sellers, query), [sellers, query]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Vendedor</Text>
      <View style={[styles.search, error ? styles.searchError : null]}>
        <Icon name="search" color={colors.textMuted} size={20} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Pesquisar vendedor"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.list}>
        {shown.map((seller) => {
          const on = seller.code === selectedCode;
          return (
            <Pressable
              key={seller.code}
              style={[styles.row, on && styles.rowOn]}
              onPress={() => onSelect(seller.code)}
              accessibilityRole="radio"
              accessibilityLabel={`Vendedor ${seller.name}`}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{seller.name}</Text>
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
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: control.height, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  searchError: { borderColor: colors.red },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  row: { minHeight: control.height, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  rowText: { fontSize: 15, fontWeight: "600", color: colors.navy },
  rowTextOn: { color: colors.onNavy },
  error: { fontSize: 12, color: colors.red, fontWeight: "600" },
});
