import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, control, radius, spacing } from "../theme";
import { FormField } from "./customer-form-parts";
import { Icon } from "./icons";

/** Runs a local search for the current text; an older answer never overwrites a newer one. */
function useSearch<T>(search: (query: string) => Promise<readonly T[]>, query: string, enabled: boolean): readonly T[] {
  const [items, setItems] = useState<readonly T[]>([]);
  const turn = useRef(0);
  useEffect(() => {
    const mine = ++turn.current;
    if (!enabled) return;
    void search(query)
      .then((found) => {
        if (mine === turn.current) setItems(found);
      })
      .catch(() => {
        if (mine === turn.current) setItems([]);
      });
  }, [search, query, enabled]);
  return enabled ? items : [];
}

export interface CityOption {
  readonly code: number;
  readonly label: string;
}

/**
 * "Cidade": a required selector with a search box and a magnifier, "Nome - UF". The search is local (accent and case blind), limited to
 * about 50 rows, drawn inline so the screen's own ScrollView scrolls (parent needs `keyboardShouldPersistTaps="handled"`).
 */
export function CityPicker({ selectedLabel, selectedCode, search, onSelect, error }: { readonly selectedLabel: string; readonly selectedCode: number | null; readonly search: (query: string) => Promise<readonly CityOption[]>; readonly onSelect: (city: CityOption) => void; readonly error?: string | null }) {
  const [query, setQuery] = useState("");
  const typing = query.trim() !== "";
  const items = useSearch(search, query, typing);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Cidade *</Text>
      {selectedCode !== null && selectedLabel !== "" && (
        <View style={styles.chosen} accessibilityLabel={`Cidade escolhida: ${selectedLabel}`}>
          <Text style={styles.chosenText} numberOfLines={1}>{selectedLabel}</Text>
        </View>
      )}
      <View style={[styles.search, error ? styles.searchError : null]}>
        <Icon name="search" color={colors.textMuted} size={20} />
        <TextInput style={styles.input} value={query} onChangeText={setQuery} accessibilityLabel="Pesquisar cidade" autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholderTextColor={colors.textMuted} />
      </View>
      {typing && (
        <View style={styles.list}>
          {items.map((city) => (
            <Pressable
              key={city.code}
              style={[styles.row, city.code === selectedCode && styles.rowOn]}
              onPress={() => {
                onSelect(city);
                setQuery("");
              }}
              accessibilityRole="radio"
              accessibilityLabel={`Cidade ${city.label}`}
              accessibilityState={{ selected: city.code === selectedCode }}
            >
              <Text style={[styles.rowText, city.code === selectedCode && styles.rowTextOn]} numberOfLines={1}>{city.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

export interface Suggestion {
  readonly code: number;
  readonly label: string;
}

/**
 * Text field with offline suggestions (neighborhood, street). Typing free text is always allowed (the code is then dropped by the
 * caller); tapping a suggestion fills the text and reports its code.
 */
export function SuggestField({ label, value, search, onChangeText, onPick, error, maxLength }: { readonly label: string; readonly value: string; readonly search: (query: string) => Promise<readonly Suggestion[]>; readonly onChangeText: (text: string) => void; readonly onPick: (suggestion: Suggestion) => void; readonly error?: string | null; readonly maxLength?: number }) {
  const [focused, setFocused] = useState(false);
  // A tapped suggestion would otherwise search again for its own text and keep the list open.
  const [settled, setSettled] = useState<string | null>(null);
  const open = focused && value.trim().length >= 2 && settled !== value;
  const items = useSearch(search, value, open);
  return (
    <View style={styles.wrap}>
      <FormField
        label={label}
        value={value}
        onChangeText={(text) => {
          setSettled(null);
          onChangeText(text);
        }}
        error={error ?? null}
        {...(maxLength === undefined ? {} : { maxLength })}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCorrect={false}
      />
      {open && items.length > 0 && (
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              key={item.code}
              style={styles.row}
              onPress={() => {
                setSettled(item.label);
                onPick(item);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${item.label}`}
            >
              <Text style={styles.rowText} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  label: { fontSize: 12, color: colors.textMuted },
  chosen: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.navy },
  chosenText: { color: colors.onNavy, fontWeight: "700", fontSize: 15 },
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
