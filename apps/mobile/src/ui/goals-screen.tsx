import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { formatBrl } from "../lib/money";
import type { GoalsPort, GoalsSnapshot } from "../offline/goals-service";
import { colors, fontSize, radius, spacing } from "../theme";
import { BackLink } from "./back-link";
import { formatTaskDateTime } from "./task-dates";

export interface GoalsScreenProps {
  readonly goals: GoalsPort;
  readonly onBack: () => void;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function goalsMonthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTHS[Number(number) - 1] ?? month} de ${year}`;
}

export function percentText(percent: string | null): string {
  return percent === null ? "—" : `${percent.replace(".", ",")}%`;
}

export function moneyText(value: string | null): string {
  return value === null ? "—" : (formatBrl(value) ?? "—");
}

export function positivationText(figure: { positivated: number; total: number; percent: string | null } | null): string {
  return figure === null ? "—" : `${figure.positivated} de ${figure.total} (${percentText(figure.percent)})`;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

/** M-24: metas e positivação do mês. Works offline with the last value read; the time of that reading is shown as data. */
export function GoalsScreen({ goals, onBack }: GoalsScreenProps) {
  const [snapshot, setSnapshot] = useState<GoalsSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let current = true;
    void goals
      .cached()
      .then((found) => {
        if (current && found !== null) setSnapshot(found);
      })
      .catch(() => undefined);
    void goals
      .load()
      .then((found) => {
        if (current && found !== null) setSnapshot(found);
      })
      .catch(() => undefined)
      .finally(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [goals]);

  const data = snapshot?.data ?? null;
  return (
    <View style={styles.root}>
      <BackLink label="Início" onPress={onBack} accessibilityLabel="Voltar para Início" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Metas
        </Text>
        {data !== null && <Text style={styles.sub}>{goalsMonthLabel(data.month)}</Text>}
        {data === null ? (
          <Text style={styles.sub}>{loaded ? "—" : "Carregando…"}</Text>
        ) : (
          <>
            <View style={styles.grid}>
              <Tile label="Meta do mês" value={moneyText(data.total.revenue.target)} />
              <Tile label="Realizado" value={moneyText(data.total.revenue.realized)} />
              <Tile label="Atingido" value={percentText(data.total.revenue.percent)} />
              <Tile label="Positivação" value={positivationText(data.total.positivation)} />
            </View>
            {data.bySeller.map((row) => (
              <View key={row.sellerCode} style={styles.row} accessible>
                <Text style={styles.rowName}>{row.sellerName ?? String(row.sellerCode)}</Text>
                <Text style={styles.rowLine}>{`Meta ${moneyText(row.revenue.target)} · Realizado ${moneyText(row.revenue.realized)} · ${percentText(row.revenue.percent)}`}</Text>
                <Text style={styles.rowLine}>{`Positivação ${positivationText(row.positivation)}`}</Text>
              </View>
            ))}
            <Text style={styles.sub}>{`Atualizado em ${formatTaskDateTime(snapshot?.fetchedAt ?? "")}`}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.title, fontWeight: "800", color: colors.navy },
  sub: { fontSize: 13, color: colors.textMuted },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  tileValue: { fontSize: fontSize.headline, fontWeight: "800", color: colors.navy },
  tileLabel: { fontSize: 13, color: colors.textMuted },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.navy },
  rowLine: { fontSize: 13, color: colors.textMuted },
});
