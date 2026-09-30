import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Account } from "../auth/auth-port";
import { colors, spacing } from "../theme";
import { roleLabel } from "./account-labels";

/** Shell of the Home: greeting and structural empty states. Indicators and quick actions arrive with M2. */
export function HomeScreen({ account }: { account: Account }) {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.greeting} accessibilityRole="header">{`Olá, ${account.displayName}`}</Text>
        <Text style={styles.role}>{roleLabel(account)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Resumo comercial</Text>
        <Text style={styles.empty}>Nenhuma informação para exibir ainda.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Atalhos</Text>
        <Text style={styles.empty}>Use a barra inferior para acessar Clientes, Vendas e Catálogo.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  greeting: { fontSize: 22, fontWeight: "800", color: colors.navy },
  role: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  empty: { fontSize: 14, color: colors.textMuted },
});
