import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Account } from "../auth/auth-port";
import { APP_ENVIRONMENT_LABEL, APP_VERSION, PRODUCT_NAME } from "../app-info";
import { colors, spacing } from "../theme";
import { initialsOf, roleLabel } from "./account-labels";
import { SyncPanel, type SyncViewProps } from "./sync-status";

export interface ProfileScreenProps extends SyncViewProps {
  readonly account: Account;
  /** Opens the existing local-orders list (Vendas). Absent when the device services are unavailable. */
  readonly onOpenLocalOrders?: () => void;
  readonly onSignOut: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function ProfileScreen({ account, onOpenLocalOrders, onSignOut, ...sync }: ProfileScreenProps) {
  function confirmSignOut() {
    const pending = sync.status.pending;
    Alert.alert(
      "Sair do Force",
      pending > 0
        ? `Há ${pending} ${pending === 1 ? "alteração pendente" : "alterações pendentes"} neste aparelho. Elas continuam salvas e serão enviadas no próximo acesso.`
        : "Pedidos salvos neste aparelho continuam guardados para o próximo acesso.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sair", style: "destructive", onPress: onSignOut },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.identity}>
        <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.avatarText}>{initialsOf(account.displayName)}</Text>
        </View>
        <Text style={styles.name}>{account.displayName}</Text>
        <Text style={styles.role}>{roleLabel(account)}</Text>
      </View>

      <Section title="Minha conta">
        <InfoRow label="Nome" value={account.displayName} />
        <InfoRow label="Usuário" value={account.username} />
        <InfoRow label="Perfil" value={roleLabel(account)} />
      </Section>

      <Section title="Sincronização">
        <SyncPanel {...sync} />
      </Section>

      {onOpenLocalOrders !== undefined && (
        <Section title="Pedidos locais / Rascunhos">
          <Pressable style={styles.link} onPress={onOpenLocalOrders} accessibilityRole="button" accessibilityLabel="Ver pedidos salvos neste aparelho">
            <Text style={styles.linkText}>Ver pedidos salvos neste aparelho</Text>
            <Text style={styles.linkHint}>{sync.status.pending > 0 ? `${sync.status.pending} pendente(s)` : "›"}</Text>
          </Pressable>
        </Section>
      )}

      <Section title="Configurações">
        <Text style={styles.muted}>Nenhuma configuração disponível nesta versão.</Text>
      </Section>

      <Section title="Sobre">
        <InfoRow label="Aplicativo" value={PRODUCT_NAME} />
        <InfoRow label="Versão" value={APP_VERSION} />
        {APP_ENVIRONMENT_LABEL !== null && <InfoRow label="Ambiente" value={APP_ENVIRONMENT_LABEL} />}
      </Section>

      <Pressable style={styles.signOut} onPress={confirmSignOut} accessibilityRole="button" accessibilityLabel="Sair">
        <Text style={styles.signOutText}>Sair</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  identity: { alignItems: "center", gap: spacing.xs },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  avatarText: { color: colors.onNavy, fontSize: 26, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800", color: colors.text },
  role: { fontSize: 14, color: colors.textMuted },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { fontSize: 14, color: colors.textMuted },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1, textAlign: "right" },
  muted: { fontSize: 14, color: colors.textMuted },
  link: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
  linkText: { fontSize: 15, fontWeight: "600", color: colors.navy },
  linkHint: { fontSize: 14, color: colors.textMuted },
  signOut: { borderWidth: 1, borderColor: colors.red, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  signOutText: { color: colors.red, fontSize: 15, fontWeight: "800" },
});
