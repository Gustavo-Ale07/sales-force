import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftStatus, SalesGroup } from "@salesforce/mobile-db";
import type { CustomerListItem, CustomerRepository } from "../data/ports";
import { brDateToIso, isoToBrDate, type SalesFilters, type SalesPeriod } from "../offline/sales";
import { saleBadge } from "../offline/sales-status";
import { colors, spacing } from "../theme";
import { ChipRow, Options, Sheet, type FilterChip } from "./customer-filters";
import { CustomerPicker } from "./customer-picker";

const PERIOD_LABEL: Record<SalesPeriod, string> = { all: "Todo o período", today: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", custom: "Personalizado" };
const PERIOD_OPTIONS = (Object.keys(PERIOD_LABEL) as SalesPeriod[]).map((value) => ({ value, label: PERIOD_LABEL[value] }));

/** Only states an unsent order can really be in; "Enviados" has a single state, so it offers no status filter. */
const UNSENT_FILTER_STATUSES: readonly DraftStatus[] = ["pending_sync", "syncing", "sync_error", "conflict", "needs_review"];

export function countActiveSalesFilters(filters: SalesFilters): number {
  return (filters.statuses.length > 0 ? 1 : 0) + (filters.customer !== null ? 1 : 0) + (filters.period !== "all" ? 1 : 0);
}

function periodChipLabel(filters: SalesFilters): string {
  if (filters.period !== "custom") return PERIOD_LABEL[filters.period];
  const from = isoToBrDate(filters.customFrom);
  const to = isoToBrDate(filters.customTo);
  return from !== "" && to !== "" ? `${from} a ${to}` : from !== "" ? `A partir de ${from}` : to !== "" ? `Até ${to}` : "Personalizado";
}

const CLEARED = { statuses: [], customer: null, period: "all", customFrom: null, customTo: null } as const;

export function SalesFilterChips({ filters, onChange }: { filters: SalesFilters; onChange: (next: SalesFilters) => void }) {
  const chips: FilterChip[] = [];
  if (filters.customer !== null) chips.push({ key: "customer", label: filters.customer.name, remove: () => onChange({ ...filters, customer: null }) });
  if (filters.statuses.length > 0) {
    chips.push({ key: "status", label: filters.statuses.map((status) => saleBadge({ status, remoteId: null }).label).join(", "), remove: () => onChange({ ...filters, statuses: [] }) });
  }
  if (filters.period !== "all") chips.push({ key: "period", label: periodChipLabel(filters), remove: () => onChange({ ...filters, period: "all", customFrom: null, customTo: null }) });
  return <ChipRow chips={chips} onClear={() => onChange({ ...filters, ...CLEARED })} />;
}

interface BodyProps {
  readonly filters: SalesFilters;
  readonly customers: CustomerRepository;
  readonly onUnauthenticated: () => void;
  readonly onApply: (next: SalesFilters) => void;
}

/** Mounted only while the sheet is open, so the draft always starts from the applied filters. */
function Body({ filters, customers, onUnauthenticated, onApply }: BodyProps) {
  const [draft, setDraft] = useState<SalesFilters>(filters);
  const [fromText, setFromText] = useState(isoToBrDate(filters.customFrom));
  const [toText, setToText] = useState(isoToBrDate(filters.customTo));
  const [picking, setPicking] = useState(false);
  const group: SalesGroup = draft.group;
  const statusOptions = [
    { value: "all", label: "Todos" },
    ...UNSENT_FILTER_STATUSES.map((status) => ({ value: status as string, label: saleBadge({ status, remoteId: null }).label })),
  ];
  const fromInvalid = draft.period === "custom" && fromText.trim() !== "" && brDateToIso(fromText) === null;
  const toInvalid = draft.period === "custom" && toText.trim() !== "" && brDateToIso(toText) === null;

  const apply = () => {
    if (fromInvalid || toInvalid) return;
    onApply({
      ...draft,
      customFrom: draft.period === "custom" ? brDateToIso(fromText) : null,
      customTo: draft.period === "custom" ? brDateToIso(toText) : null,
    });
  };

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Cliente</Text>
          <Pressable style={styles.field} onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Escolher cliente">
            <Text style={[styles.fieldText, draft.customer === null && styles.fieldPlaceholder]}>{draft.customer?.name ?? "Todos os clientes"}</Text>
          </Pressable>
          {draft.customer !== null && (
            <Pressable onPress={() => setDraft({ ...draft, customer: null })} accessibilityRole="button" accessibilityLabel="Remover cliente do filtro" style={styles.inline}>
              <Text style={styles.clearText}>Remover cliente</Text>
            </Pressable>
          )}
        </View>
        {group === "unsent" && (
          <Options
            label="Situação"
            options={statusOptions}
            value={draft.statuses.length === 0 ? "all" : (draft.statuses[0] as string)}
            onSelect={(value) => setDraft({ ...draft, statuses: value === "all" ? [] : [value as DraftStatus] })}
          />
        )}
        <Options label="Período (data de criação neste aparelho)" options={PERIOD_OPTIONS} value={draft.period} onSelect={(period) => setDraft({ ...draft, period })} />
        {draft.period === "custom" && (
          <View style={styles.dates}>
            <View style={styles.dateBox}>
              <TextInput style={[styles.input, fromInvalid && styles.inputInvalid]} value={fromText} onChangeText={setFromText} placeholder="De (DD/MM/AAAA)" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" accessibilityLabel="Data inicial" maxLength={10} />
              {fromInvalid && <Text style={styles.invalid}>Data inválida</Text>}
            </View>
            <View style={styles.dateBox}>
              <TextInput style={[styles.input, toInvalid && styles.inputInvalid]} value={toText} onChangeText={setToText} placeholder="Até (DD/MM/AAAA)" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" accessibilityLabel="Data final" maxLength={10} />
              {toInvalid && <Text style={styles.invalid}>Data inválida</Text>}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          style={styles.secondary}
          onPress={() => {
            setDraft({ ...draft, ...CLEARED });
            setFromText("");
            setToText("");
          }}
          accessibilityRole="button"
          accessibilityLabel="Limpar seleção"
        >
          <Text style={styles.secondaryText}>Limpar</Text>
        </Pressable>
        <Pressable style={[styles.primary, (fromInvalid || toInvalid) && styles.primaryOff]} onPress={apply} accessibilityRole="button" accessibilityLabel="Aplicar filtros">
          <Text style={styles.primaryText}>Aplicar</Text>
        </Pressable>
      </View>
      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle} accessibilityRole="header">Filtrar por cliente</Text>
            <Pressable onPress={() => setPicking(false)} accessibilityRole="button" accessibilityLabel="Fechar seleção de cliente" style={styles.inline}>
              <Text style={styles.clearText}>Fechar</Text>
            </Pressable>
          </View>
          <CustomerPicker
            customers={customers}
            allowUnavailable
            onUnauthenticated={onUnauthenticated}
            onSelect={(picked: CustomerListItem) => {
              setDraft({ ...draft, customer: { code: picked.code, name: picked.name } });
              setPicking(false);
            }}
          />
        </View>
      </Modal>
    </>
  );
}

export function SalesFiltersSheet({ visible, onClose, ...body }: BodyProps & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filtros">
      {visible && <Body {...body} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.lg },
  group: { gap: spacing.sm },
  groupTitle: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  field: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, justifyContent: "center", backgroundColor: colors.surface },
  fieldText: { fontSize: 15, color: colors.text, fontWeight: "600" },
  fieldPlaceholder: { color: colors.textMuted, fontWeight: "400" },
  inline: { minHeight: 44, justifyContent: "center" },
  clearText: { color: colors.red, fontSize: 13, fontWeight: "700" },
  dates: { flexDirection: "row", gap: spacing.sm },
  dateBox: { flex: 1, gap: 2 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, fontSize: 15, color: colors.text, backgroundColor: colors.surface },
  inputInvalid: { borderColor: colors.red },
  invalid: { fontSize: 12, color: colors.red },
  actions: { flexDirection: "row", gap: spacing.md },
  secondary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 15 },
  primary: { flex: 2, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.navy },
  primaryOff: { opacity: 0.5 },
  primaryText: { color: colors.onNavy, fontWeight: "700", fontSize: 15 },
  picker: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pickerTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
});
