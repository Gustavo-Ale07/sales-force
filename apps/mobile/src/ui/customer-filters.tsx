import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CustomerFilters, CustomerLetter, CustomerSellerOption } from "../data/ports";
import { colors, spacing } from "../theme";
import { useInsets } from "./use-insets";

const STATUS_OPTIONS: ReadonlyArray<{ value: CustomerFilters["status"]; label: string }> = [
  { value: undefined, label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
  { value: "blocked", label: "Bloqueados" },
];
const PRICE_TABLE_OPTIONS: ReadonlyArray<{ value: boolean | undefined; label: string }> = [
  { value: undefined, label: "Todos" },
  { value: true, label: "Com tabela" },
  { value: false, label: "Sem tabela" },
];

export function countActiveFilters(filters: CustomerFilters): number {
  return (filters.status !== undefined ? 1 : 0) + (filters.sellerCode !== undefined ? 1 : 0) + (filters.hasPriceTable !== undefined ? 1 : 0);
}

const STATUS_LABEL = { active: "Ativos", inactive: "Inativos", blocked: "Bloqueados" } as const;

/** One chip per active filter, each removable, plus "Limpar filtros". Nothing renders without an active filter. */
export function FilterChips({
  filters,
  sellers,
  onChange,
}: {
  filters: CustomerFilters;
  sellers: readonly CustomerSellerOption[];
  onChange: (next: CustomerFilters) => void;
}) {
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.status !== undefined) chips.push({ key: "status", label: STATUS_LABEL[filters.status], remove: () => onChange({ ...filters, status: undefined }) });
  if (filters.sellerCode !== undefined) {
    const seller = sellers.find((option) => option.code === filters.sellerCode);
    chips.push({ key: "seller", label: `Vendedor: ${seller?.name ?? filters.sellerCode}`, remove: () => onChange({ ...filters, sellerCode: undefined }) });
  }
  if (filters.hasPriceTable !== undefined) {
    chips.push({ key: "table", label: filters.hasPriceTable ? "Com tabela de preço" : "Sem tabela de preço", remove: () => onChange({ ...filters, hasPriceTable: undefined }) });
  }
  if (chips.length === 0) return null;
  return (
    <View style={styles.chips}>
      {chips.map((chip) => (
        <Pressable key={chip.key} style={styles.chip} onPress={chip.remove} accessibilityRole="button" accessibilityLabel={`Remover filtro ${chip.label}`}>
          <Text style={styles.chipText}>{`${chip.label} ×`}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.clear} onPress={() => onChange({})} accessibilityRole="button" accessibilityLabel="Limpar filtros">
        <Text style={styles.clearText}>Limpar filtros</Text>
      </Pressable>
    </View>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={`Fechar ${title}`} />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

function Options<V>({ label, options, value, onSelect }: { label: string; options: ReadonlyArray<{ value: V; label: string }>; value: V; onSelect: (value: V) => void }) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.groupTitle}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.label}
            style={[styles.option, option.value === value && styles.optionOn]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: option.value === value }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.optionText, option.value === value && styles.optionTextOn]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type FiltersBodyProps = { filters: CustomerFilters; sellers: readonly CustomerSellerOption[]; onApply: (next: CustomerFilters) => void };

/** Mounted only while the sheet is open, so the draft always starts from the applied filters. */
function FiltersBody({ filters, sellers, onApply }: FiltersBodyProps) {
  const [draft, setDraft] = useState<CustomerFilters>(filters);
  const sellerOptions = [
    { value: undefined as number | undefined, label: "Todos" },
    ...sellers.map((seller) => ({ value: seller.code as number | undefined, label: seller.name ?? `Vendedor ${seller.code}` })),
  ];
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Options label="Situação" options={STATUS_OPTIONS} value={draft.status} onSelect={(status) => setDraft({ ...draft, status })} />
        {sellers.length > 0 && <Options label="Vendedor" options={sellerOptions} value={draft.sellerCode} onSelect={(sellerCode) => setDraft({ ...draft, sellerCode })} />}
        <Options label="Tabela de preço" options={PRICE_TABLE_OPTIONS} value={draft.hasPriceTable} onSelect={(hasPriceTable) => setDraft({ ...draft, hasPriceTable })} />
      </ScrollView>
      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={() => setDraft({})} accessibilityRole="button" accessibilityLabel="Limpar seleção">
          <Text style={styles.secondaryText}>Limpar</Text>
        </Pressable>
        <Pressable style={styles.primary} onPress={() => onApply(draft)} accessibilityRole="button" accessibilityLabel="Aplicar filtros">
          <Text style={styles.primaryText}>Aplicar</Text>
        </Pressable>
      </View>
    </>
  );
}

/** Bottom sheet with only the filters the customer data really supports (status, seller, price table). */
export function CustomerFiltersSheet({ visible, onClose, ...body }: FiltersBodyProps & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filtros">
      {visible && <FiltersBody {...body} />}
    </Sheet>
  );
}

const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** Alphabetical index as a grid of large touch targets; letters without customers are disabled. */
export function CustomerIndexSheet({
  visible,
  letters,
  activeOffset,
  onPick,
  onClose,
}: {
  visible: boolean;
  letters: readonly CustomerLetter[];
  activeOffset: number;
  onPick: (letter: CustomerLetter | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Índice alfabético">
      <View style={styles.grid}>
        {ALPHABET.map((letter) => {
          const entry = letters.find((candidate) => candidate.letter === letter);
          const selected = entry !== undefined && entry.offset === activeOffset && activeOffset > 0;
          return (
            <Pressable
              key={letter}
              disabled={entry === undefined}
              style={[styles.letter, selected && styles.optionOn, entry === undefined && styles.letterOff]}
              onPress={() => onPick(entry ?? null)}
              accessibilityRole="button"
              accessibilityLabel={entry === undefined ? `Letra ${letter}, sem clientes` : `Letra ${letter}, ${entry.count} ${entry.count === 1 ? "cliente" : "clientes"}`}
              accessibilityState={{ disabled: entry === undefined, selected }}
            >
              <Text style={[styles.letterText, selected && styles.optionTextOn]}>{letter}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable style={styles.secondary} onPress={() => onPick(null)} accessibilityRole="button" accessibilityLabel="Voltar ao início">
        <Text style={styles.secondaryText}>Voltar ao início</Text>
      </Pressable>
      <Text style={styles.hint}>A lista passa a começar na letra escolhida.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  chip: { backgroundColor: colors.navy, borderRadius: 16, paddingHorizontal: spacing.md, minHeight: 32, justifyContent: "center" },
  chipText: { color: colors.onNavy, fontSize: 13, fontWeight: "700" },
  clear: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.xs },
  clearText: { color: colors.red, fontSize: 13, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, maxHeight: "85%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.lg },
  group: { gap: spacing.sm },
  groupTitle: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: "center", backgroundColor: colors.surface },
  optionOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  optionText: { fontSize: 14, fontWeight: "600", color: colors.text },
  optionTextOn: { color: colors.onNavy },
  actions: { flexDirection: "row", gap: spacing.md },
  secondary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 15 },
  primary: { flex: 2, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.navy },
  primaryText: { color: colors.onNavy, fontWeight: "700", fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  letter: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  letterOff: { opacity: 0.35 },
  letterText: { fontSize: 16, fontWeight: "700", color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted },
});
