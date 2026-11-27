import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import { useInsets } from "./use-insets";

export type DeviceNoticeKind = "locked" | "key_lost";

interface Notice {
  readonly title: string;
  readonly message: string;
  readonly action: string;
}

/** Texts of M-18 (bloqueio por dias sem sincronizar), and the lost local key. */
export const DEVICE_NOTICES: Record<DeviceNoticeKind, Notice> = {
  locked: {
    title: "Conecte-se para continuar",
    message: "Este aparelho ficou dias demais sem sincronizar. Conecte-se à internet e entre de novo.",
    action: "Entrar",
  },
  key_lost: {
    title: "Chave local perdida",
    message: "A chave que protege os dados deste aparelho não foi encontrada e os dados não podem ser abertos. Apague-os para começar de novo; pedidos que não foram enviados serão perdidos.",
    action: "Apagar dados e recomeçar",
  },
};

export interface DeviceNoticeScreenProps {
  readonly kind: DeviceNoticeKind;
  readonly onAction: () => void;
  /** An action is running (sign-out, wipe): the button waits. */
  readonly busy?: boolean;
}

export function DeviceNoticeScreen({ kind, onAction, busy = false }: DeviceNoticeScreenProps) {
  const insets = useInsets();
  const notice = DEVICE_NOTICES[kind];
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
      <Text style={styles.title} accessibilityRole="header">
        {notice.title}
      </Text>
      <Text style={styles.message}>{notice.message}</Text>
      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={onAction}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={notice.action}
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>{notice.action}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  message: { fontSize: 15, color: colors.textMuted },
  button: { marginTop: spacing.md, minHeight: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.text, paddingHorizontal: spacing.lg },
  buttonBusy: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: "600", color: colors.background },
});
