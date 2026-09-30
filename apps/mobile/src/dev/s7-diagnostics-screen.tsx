import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import { runS7Diagnostics, type StepResult } from "./s7-diagnostics";

/** DEV-ONLY screen for spike S7 (see s7-diagnostics.ts). Logs every step as `S7RESULT {json}` for adb logcat. */
export function S7DiagnosticsScreen() {
  const [results, setResults] = useState<StepResult[]>([]);
  const [finished, setFinished] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void runS7Diagnostics((result) => {
      console.log(`S7RESULT ${JSON.stringify(result)}`);
      if (active) setResults((current) => [...current, result]);
    })
      .then((allOk) => {
        console.log(`S7DONE ${JSON.stringify({ allOk })}`);
        if (active) setFinished(allOk);
      })
      .catch((error: unknown) => {
        console.log(`S7DONE ${JSON.stringify({ allOk: false, fatal: String(error) })}`);
        if (active) setFinished(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Diagnóstico S7 / V-09</Text>
      <Text style={styles.status}>{finished === null ? "Executando…" : finished ? "TODOS OS PASSOS OK" : "HÁ FALHAS"}</Text>
      {results.map((result) => (
        <View key={result.name} style={styles.card}>
          <Text style={[styles.step, result.ok ? styles.ok : styles.fail]}>{`${result.ok ? "OK" : "FALHA"} · ${result.name} · ${result.ms} ms`}</Text>
          <Text style={styles.detail}>{result.detail}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  status: { fontSize: 16, fontWeight: "700", color: colors.text },
  card: { gap: spacing.xs },
  step: { fontSize: 14, fontWeight: "700" },
  ok: { color: "#1b7f3b" },
  fail: { color: "#b3261e" },
  detail: { fontSize: 12, color: colors.textMuted },
});
