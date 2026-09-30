import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ProductFilters, ProductGroupOption } from "../data/ports";
import { colors, spacing } from "../theme";
import { ChipRow, Options, Sheet, type FilterChip } from "./customer-filters";

const PRICE_OPTIONS: ReadonlyArray<{ value: ProductFilters["priceState"]; label: string }> = [
  { value: undefined, label: "Todos" },
  { value: "priced", label: "Com preço" },
  { value: "none", label: "Sem preço" },
];

export function countActiveProductFilters(filters: ProductFilters): number {
  return (filters.groupCodes?.length ?? 0) + (filters.priceState !== undefined ? 1 : 0);
}

export function groupLabel(groups: readonly ProductGroupOption[], code: number): string {
  return groups.find((group) => group.code === code)?.name ?? `Grupo ${code}`;
}

function withoutEmptyGroups(filters: ProductFilters): ProductFilters {
  const { groupCodes, ...rest } = filters;
  return groupCodes !== undefined && groupCodes.length > 0 ? { ...rest, groupCodes } : rest;
}

/** One removable chip per selected group and per price filter, plus "Limpar filtros". */
export function ProductFilterChips({ filters, groups, onChange }: { filters: ProductFilters; groups: readonly ProductGroupOption[]; onChange: (next: ProductFilters) => void }) {
  const chips: FilterChip[] = (filters.groupCodes ?? []).map((code) => ({
    key: `group-${code}`,
    label: `Grupo: ${groupLabel(groups, code)}`,
    remove: () => onChange(withoutEmptyGroups({ ...filters, groupCodes: (filters.groupCodes ?? []).filter((candidate) => candidate !== code) })),
  }));
  if (filters.priceState !== undefined) {
    const { priceState: _removed, ...rest } = filters;
    chips.push({ key: "price", label: filters.priceState === "priced" ? "Com preço" : "Sem preço", remove: () => onChange(rest) });
  }
  return <ChipRow chips={chips} onClear={() => onChange({})} />;
}

type BodyProps = { filters: ProductFilters; groups: readonly ProductGroupOption[]; onApply: (next: ProductFilters) => void; onCancel: () => void };

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mounted only while the sheet is open, so the draft always starts from the applied filters. */
function ProductFiltersBody({ filters, groups, onApply, onCancel }: BodyProps) {
  const [draft, setDraft] = useState<ProductFilters>(filters);
  const [query, setQuery] = useState("");
  const selected = new Set(draft.groupCodes ?? []);
  const needle = normalize(query.trim());
  const visible = needle === "" ? groups : groups.filter((group) => normalize(`${group.name ?? ""} ${group.code}`).includes(needle));

  const toggle = (code: number) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraft(withoutEmptyGroups({ ...draft, groupCodes: [...next] }));
  };

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Options label="Preço" options={PRICE_OPTIONS} value={draft.priceState} onSelect={(priceState) => setDraft(priceState === undefined ? (({ priceState: _p, ...rest }) => rest)(draft) : { ...draft, priceState })} />
        {groups.length > 0 && (
          <View style={styles.groupBlock}>
            <Text style={styles.groupTitle}>Grupo</Text>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar grupo"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Buscar grupo"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {visible.length === 0 && <Text style={styles.empty}>Nenhum grupo encontrado.</Text>}
            {visible.map((group) => {
              const on = selected.has(group.code);
              const name = group.name ?? `Grupo ${group.code}`;
              return (
                <Pressable
                  key={group.code}
                  style={styles.groupRow}
                  onPress={() => toggle(group.code)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${name}, ${group.count} ${group.count === 1 ? "produto" : "produtos"}`}
                >
                  <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.tick}>✓</Text>}</View>
                  <Text style={styles.groupName} numberOfLines={2}>{name}</Text>
                  <Text style={styles.groupCount}>{group.count}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={() => setDraft({})} accessibilityRole="button" accessibilityLabel="Limpar seleção">
          <Text style={styles.secondaryText}>Limpar</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancelar">
          <Text style={styles.secondaryText}>Cancelar</Text>
        </Pressable>
        <Pressable style={styles.primary} onPress={() => onApply(draft)} accessibilityRole="button" accessibilityLabel="Aplicar filtros">
          <Text style={styles.primaryText}>Aplicar</Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * Bottom sheet with the filters the product data really supports: price state and group (multi-select). The ERP
 * mirror delivers a flat group code only (no subgroup/hierarchy), so the group list is flat by design.
 */
export function ProductFiltersSheet({ visible, onClose, ...body }: Omit<BodyProps, "onCancel"> & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filtros">
      {visible && <ProductFiltersBody {...body} onCancel={onClose} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.lg },
  groupBlock: { gap: spacing.sm },
  groupTitle: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 15, color: colors.text, backgroundColor: colors.surface },
  empty: { fontSize: 13, color: colors.textMuted },
  groupRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.navy },
  tick: { color: colors.onNavy, fontSize: 14, fontWeight: "800" },
  groupName: { flex: 1, fontSize: 15, color: colors.text },
  groupCount: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: "row", gap: spacing.sm },
  secondary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  primary: { flex: 1.4, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.navy },
  primaryText: { color: colors.onNavy, fontWeight: "700", fontSize: 15 },
});
