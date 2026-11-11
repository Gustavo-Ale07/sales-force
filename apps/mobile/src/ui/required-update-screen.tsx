import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export interface RequiredUpdateScreenProps {
  readonly versionName: string;
  /** Downloads, verifies and opens the installer; resolves with the message to show. */
  readonly onInstall: (onStatus: (text: string) => void) => Promise<string>;
}

/** Blocking screen: nothing else in the app is reachable until the build is updated. */
export function RequiredUpdateScreen({ versionName, onInstall }: RequiredUpdateScreenProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function install() {
    if (busy) return;
    setBusy(true);
    try {
      setMessage(await onInstall(setMessage));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">Atualização obrigatória</Text>
      <Text style={styles.text}>{`Esta versão do aplicativo não é mais aceita. Instale a versão ${versionName} para continuar usando o Force.`}</Text>
      <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={() => void install()} disabled={busy} accessibilityRole="button" accessibilityLabel="Baixar e instalar">
        <Text style={styles.buttonText}>{busy ? "Aguarde…" : "Baixar e instalar"}</Text>
      </Pressable>
      {message !== null && <Text style={styles.status} accessibilityLiveRegion="polite">{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  text: { fontSize: 15, color: colors.textMuted },
  button: { minHeight: 48, borderRadius: 10, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700" },
  status: { fontSize: 14, color: colors.textMuted },
});
