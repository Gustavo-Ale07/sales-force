import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { cascadeLevels, groupCodesOf, groupPathLabel, type GroupPath, type ProductGroupTree } from "../data/group-cascade";
import type { ProductFilters } from "../data/ports";
import { colors, radius, spacing } from "../theme";
import { Icon } from "./icons";
import { ChipRow, Sheet, type FilterChip } from "./customer-filters";

export const EMPTY_GROUP_TREE: ProductGroupTree = { items: [], hierarchical: false, hasUngrouped: false };

export function countActiveProductFilters(filters: ProductFilters): number {
  return (filters.groupCodes?.length ?? 0) > 0 ? 1 : 0;
}

/** The filters for a cascade selection: the codes the local list matches (the server's subtree) and the selection itself. */
export function filtersOfPath(tree: ProductGroupTree, path: GroupPath): ProductFilters {
  const groupCodes = groupCodesOf(tree, path);
  return groupCodes.length === 0 ? {} : { groupPath: [...path], groupCodes };
}

/** One removable chip for the chosen group (deepest level), plus "Limpar filtros". */
export function ProductFilterChips({ filters, tree, onChange }: { filters: ProductFilters; tree: ProductGroupTree; onChange: (next: ProductFilters) => void }) {
  const path = filters.groupPath ?? [];
  const chips: FilterChip[] =
    countActiveProductFilters(filters) === 0
      ? []
      : [{ key: "group", label: groupPathLabel(tree, path), remove: () => onChange(filtersOfPath(tree, path.slice(0, -1))) }];
  return <ChipRow chips={chips} onClear={() => onChange({})} />;
}

type BodyProps = { filters: ProductFilters; tree: ProductGroupTree; onApply: (next: ProductFilters) => void; onCancel: () => void };

const ALL_LABEL = { Grupo: "Todos os grupos", Subgrupo: "Todos os subgrupos", Linha: "Todas as linhas" } as const;

/** Mounted only while the sheet is open, so the draft always starts from the applied filters. */
function ProductFiltersBody({ filters, tree, onApply, onCancel }: BodyProps) {
  const [path, setPath] = useState<GroupPath>(filters.groupPath ?? []);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const { levels, path: valid } = cascadeLevels(tree, path);

  // Choosing a level clears the ones below it; "Todos" cuts the path at that level.
  const choose = (depth: number, value: number | null) => {
    setPath(value === null ? valid.slice(0, depth) : [...valid.slice(0, depth), value]);
    setOpenLevel(null);
  };

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {levels.map((level, depth) => {
          const chosen = level.options.find((option) => option.value === level.value)?.label ?? ALL_LABEL[level.label];
          const expanded = openLevel === depth && !level.disabled;
          return (
            <View key={level.label} style={styles.groupBlock}>
              <Text style={styles.groupTitle}>{level.label}</Text>
              <Pressable
                style={[styles.field, level.disabled && styles.fieldOff]}
                disabled={level.disabled}
                onPress={() => setOpenLevel(expanded ? null : depth)}
                accessibilityRole="button"
                accessibilityState={{ disabled: level.disabled, expanded }}
                accessibilityLabel={`${level.label}: ${chosen}`}
              >
                <Text style={[styles.fieldText, level.disabled && styles.fieldTextOff]} numberOfLines={1}>{chosen}</Text>
              </Pressable>
              {expanded && (
                <View accessibilityRole="radiogroup" accessibilityLabel={level.label}>
                  <Pressable
                    style={styles.groupRow}
                    onPress={() => choose(depth, null)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: level.value === null }}
                    accessibilityLabel={ALL_LABEL[level.label]}
                  >
                    <View style={[styles.box, level.value === null && styles.boxOn]}>{level.value === null && <Icon name="check" size={16} color={colors.onNavy} />}</View>
                    <Text style={styles.groupName}>{ALL_LABEL[level.label]}</Text>
                  </Pressable>
                  {level.options.map((option) => {
                    const on = level.value === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={styles.groupRow}
                        onPress={() => choose(depth, option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={option.label}
                      >
                        <View style={[styles.box, on && styles.boxOn]}>{on && <Icon name="check" size={16} color={colors.onNavy} />}</View>
                        <Text style={styles.groupName} numberOfLines={2}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={() => setPath([])} accessibilityRole="button" accessibilityLabel="Limpar seleção">
          <Text style={styles.secondaryText}>Limpar</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancelar">
          <Text style={styles.secondaryText}>Cancelar</Text>
        </Pressable>
        <Pressable style={styles.primary} onPress={() => onApply(filtersOfPath(tree, valid))} accessibilityRole="button" accessibilityLabel="Aplicar filtros">
          <Text style={styles.primaryText}>Aplicar</Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * Bottom sheet with the catalog's one filter: the Grupo > Subgrupo > Linha cascade (same levels and names as the site). No price
 * filter: the catalog only holds priced products. Without a hierarchy on the device it is the flat Grupo list.
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
  field: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48, justifyContent: "center", backgroundColor: colors.surface },
  fieldOff: { backgroundColor: colors.background, opacity: 0.6 },
  fieldText: { fontSize: 15, color: colors.text },
  fieldTextOff: { color: colors.textMuted },
  groupRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  box: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.navy },
  groupName: { flex: 1, fontSize: 15, color: colors.text },
  actions: { flexDirection: "row", gap: spacing.sm },
  secondary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  primary: { flex: 1.4, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.navy },
  primaryText: { color: colors.onNavy, fontWeight: "700", fontSize: 15 },
});
