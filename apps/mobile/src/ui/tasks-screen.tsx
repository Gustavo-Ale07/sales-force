import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { LocalTask, TaskType } from "@salesforce/mobile-db";
import type { TasksPort } from "../offline/tasks-service";
import { colors, radius, spacing } from "../theme";
import { BackLink } from "./back-link";
import { formatTaskDateTime, parseTaskDateTime, TASK_REMINDER_OPTIONS, TASK_TYPE_LABEL } from "./task-dates";

export interface TasksScreenProps {
  readonly tasks: TasksPort;
  readonly onBack: () => void;
}

type Filter = "pending" | "late" | "done";

/** M-15: tarefas. Creating and completing work offline; the sync sends them later with the same ids. */
export function TasksScreen({ tasks, onBack }: TasksScreenProps) {
  const [items, setItems] = useState<LocalTask[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    setItems(await tasks.list());
    setNow(Date.now());
  }, [tasks]);
  useEffect(() => {
    void tasks.list().then(setItems);
    void tasks.sync().then(load);
  }, [tasks, load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
      void tasks.sync().then(load);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível concluir a ação.");
    }
  };

  const visible = items.filter((task) => {
    if (filter === "done") return task.status !== "pending";
    if (task.status !== "pending") return false;
    return filter === "late" ? Date.parse(task.dueAt) < now : true;
  });

  if (creating) {
    return (
      <NewTask
        onCancel={() => setCreating(false)}
        onSave={(input) =>
          run(async () => {
            await tasks.create(input);
            setCreating(false);
          })
        }
        error={error}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <BackLink label="Voltar" onPress={onBack} accessibilityLabel="Voltar" />
      <View style={styles.titleRow}>
        <Text style={styles.title}>Tarefas</Text>
        <Pressable style={styles.primary} onPress={() => setCreating(true)} accessibilityRole="button" accessibilityLabel="Nova tarefa">
          <Text style={styles.primaryText}>Nova tarefa</Text>
        </Pressable>
      </View>
      <View style={styles.filters}>
        {([["pending", "Abertas"], ["late", "Atrasadas"], ["done", "Encerradas"]] as const).map(([value, label]) => (
          <Pressable key={value} style={[styles.chip, filter === value && styles.chipOn]} onPress={() => setFilter(value)} accessibilityRole="button" accessibilityState={{ selected: filter === value }}>
            <Text style={[styles.chipText, filter === value && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={visible}
        keyExtractor={(task) => task.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma tarefa.</Text>}
        renderItem={({ item }) => {
          const late = item.status === "pending" && Date.parse(item.dueAt) < now;
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.meta}>
                {TASK_TYPE_LABEL[item.type]} - {formatTaskDateTime(item.dueAt)}
                {item.customerName !== null ? ` - ${item.customerName}` : item.customerCode !== null ? ` - Cliente ${item.customerCode}` : ""}
              </Text>
              {late && <Text style={styles.late}>Atrasada</Text>}
              {item.status !== "pending" && <Text style={styles.meta}>{item.status === "completed" ? "Concluída" : "Cancelada"}</Text>}
              {item.syncState === "queued" || item.syncState === "sending" ? <Text style={styles.meta}>Aguardando envio</Text> : null}
              {item.syncState === "rejected" && <Text style={styles.late}>{item.lastError ?? "Tarefa recusada."}</Text>}
              {item.status === "pending" && (
                <View style={styles.actions}>
                  <Pressable style={styles.primary} onPress={() => void run(() => tasks.complete(item.id))} accessibilityRole="button" accessibilityLabel={`Concluir ${item.title}`}>
                    <Text style={styles.primaryText}>Concluir</Text>
                  </Pressable>
                  <Pressable style={styles.secondary} onPress={() => void run(() => tasks.cancel(item.id))} accessibilityRole="button" accessibilityLabel={`Cancelar ${item.title}`}>
                    <Text style={styles.secondaryText}>Cancelar</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function NewTask({ onSave, onCancel, error }: { onSave: (input: Parameters<TasksPort["create"]>[0]) => void; onCancel: () => void; error: string | null }) {
  const [type, setType] = useState<TaskType>("call");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [lead, setLead] = useState<number | null>(30);
  const [customer, setCustomer] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const save = () => {
    const dueAt = parseTaskDateTime(date, time);
    if (title.trim() === "") return setLocalError("Informe o título da tarefa.");
    if (dueAt === null) return setLocalError("Informe a data (dd/mm/aaaa) e a hora (hh:mm).");
    const code = customer.trim() === "" ? null : Number(customer);
    if (code !== null && !Number.isInteger(code)) return setLocalError("Código de cliente inválido.");
    setLocalError(null);
    onSave({ type, title: title.trim(), description: description.trim() === "" ? null : description.trim(), dueAt, reminderLeadMinutes: lead, customerCode: code });
  };

  return (
    <View style={styles.screen}>
      <BackLink label="Tarefas" onPress={onCancel} accessibilityLabel="Voltar para tarefas" />
      <Text style={styles.title}>Nova tarefa</Text>
      <View style={styles.filters}>
        {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((value) => (
          <Pressable key={value} style={[styles.chip, type === value && styles.chipOn]} onPress={() => setType(value)} accessibilityRole="button" accessibilityState={{ selected: type === value }}>
            <Text style={[styles.chipText, type === value && styles.chipTextOn]}>{TASK_TYPE_LABEL[value]}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Título" maxLength={120} accessibilityLabel="Título" />
      <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Descrição" maxLength={2000} multiline accessibilityLabel="Descrição" />
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.flex]} value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" accessibilityLabel="Data" />
        <TextInput style={[styles.input, styles.flex]} value={time} onChangeText={setTime} placeholder="hh:mm" keyboardType="numbers-and-punctuation" accessibilityLabel="Hora" />
      </View>
      <TextInput style={styles.input} value={customer} onChangeText={setCustomer} placeholder="Código do cliente" keyboardType="number-pad" accessibilityLabel="Código do cliente" />
      <View style={styles.filters}>
        {TASK_REMINDER_OPTIONS.map((option) => (
          <Pressable key={String(option.value)} style={[styles.chip, lead === option.value && styles.chipOn]} onPress={() => setLead(option.value)} accessibilityRole="button" accessibilityState={{ selected: lead === option.value }}>
            <Text style={[styles.chipText, lead === option.value && styles.chipTextOn]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {(localError ?? error) !== null && <Text style={styles.error}>{localError ?? error}</Text>}
      <Pressable style={styles.primary} onPress={save} accessibilityRole="button" accessibilityLabel="Salvar tarefa">
        <Text style={styles.primaryText}>Salvar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "700", color: colors.navy },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.onNavy, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  late: { fontSize: 12, fontWeight: "700", color: colors.red },
  error: { fontSize: 14, color: colors.red },
  empty: { fontSize: 14, color: colors.textMuted, padding: spacing.lg },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  primary: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center", borderRadius: radius.md, backgroundColor: colors.navy },
  primaryText: { color: colors.onNavy, fontWeight: "700", fontSize: 14 },
  secondary: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy },
  secondaryText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontSize: 16, color: colors.text },
});
