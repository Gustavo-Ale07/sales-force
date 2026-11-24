import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Account } from "../auth/auth-port";
import { APP_BUILD_LABEL, APP_ENVIRONMENT_LABEL, PRODUCT_NAME } from "../app-info";
import { colors, radius, spacing } from "../theme";
import { Icon } from "./icons";
import { roleLabel } from "./account-labels";
import { Avatar } from "./avatar";
import { PHOTO_OFFLINE_MESSAGE, type PhotoSource, type ProfilePhotoService } from "../photo/profile-photo";
import { useAppModal } from "./app-modal";
import { SyncPanel, type SyncViewProps } from "./sync-status";

export interface ProfileScreenProps extends SyncViewProps {
  readonly account: Account;
  /** Opens the existing local-orders list (Vendas). Absent when the device services are unavailable. */
  readonly onOpenLocalOrders?: () => void;
  /** In-app APK update (Android builds with a channel). Resolves with the final message; absent = no update section. */
  readonly onCheckUpdate?: (onStatus: (text: string) => void) => Promise<string>;
  readonly onSignOut: () => void;
  /** Orders and customers of this account not yet sent (outbox + queue). Absent = falls back to the sync counters. */
  readonly loadUnsent?: () => Promise<number>;
  /** Profile photo: the file to show and the service behind "Trocar foto" / "Remover foto". Absent = initials only. */
  readonly photo?: { readonly service: ProfilePhotoService; readonly uri: string | null; readonly onChanged: (version: string | null) => void };
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

export function ProfileScreen({ account, onOpenLocalOrders, onCheckUpdate, onSignOut, loadUnsent, photo, ...sync }: ProfileScreenProps) {
  const modal = useAppModal();
  const [photoBusy, setPhotoBusy] = useState(false);
  const offline = sync.connectivity === "offline";

  function runPhoto(work: () => ReturnType<ProfilePhotoService["change"]>) {
    if (photo === undefined || photoBusy) return;
    setPhotoBusy(true);
    void work()
      .then((result) => {
        if (result.ok) photo.onChanged(result.version);
        else if (result.cancelled !== true) modal.show({ variant: "error", title: "Foto não alterada", message: result.message });
      })
      .finally(() => setPhotoBusy(false));
  }

  function changePhoto() {
    if (photo === undefined || photoBusy) return;
    if (offline) {
      modal.show({ variant: "info", title: "Sem conexão", message: PHOTO_OFFLINE_MESSAGE });
      return;
    }
    const choose = (source: PhotoSource) => runPhoto(() => photo.service.change(source));
    modal.show({
      variant: "confirm",
      title: "Trocar foto",
      buttons: [
        { label: "Tirar foto", role: "primary", onPress: () => choose("camera") },
        { label: "Escolher da galeria", role: "secondary", onPress: () => choose("gallery") },
        { label: "Cancelar", role: "cancel" },
      ],
    });
  }

  async function removePhoto() {
    if (photo === undefined || photoBusy) return;
    if (offline) {
      modal.show({ variant: "info", title: "Sem conexão", message: PHOTO_OFFLINE_MESSAGE });
      return;
    }
    const confirmed = await modal.confirm({ title: "Remover foto", confirmLabel: "Remover", destructive: true });
    if (confirmed) runPhoto(() => photo.service.remove());
  }
  const [updateText, setUpdateText] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  async function checkUpdate() {
    if (!onCheckUpdate || updating) return;
    setUpdating(true);
    try {
      setUpdateText(await onCheckUpdate(setUpdateText));
    } finally {
      setUpdating(false);
    }
  }

  async function confirmSignOut() {
    let unsent = sync.status.pending + sync.status.needsAttention;
    if (loadUnsent !== undefined) {
      try {
        unsent = await loadUnsent();
      } catch {
        // Unknown count: keep the counters, which only err on the side of warning.
      }
    }
    const confirmed = await modal.confirm({
      title: "Sair do Force",
      message:
        unsent > 0
          ? `Há ${unsent} ${unsent === 1 ? "item ainda não enviado" : "itens ainda não enviados"} neste aparelho. Eles continuam salvos, só para esta conta, e serão enviados quando você entrar de novo e sincronizar.`
          : "Os dados baixados (clientes, produtos e preços) serão apagados deste aparelho. Entre de novo para baixá-los.",
      confirmLabel: "Sair",
      destructive: true,
    });
    if (confirmed) onSignOut();
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.identity}>
        {photo !== undefined && photo.service.canChange ? (
          <Pressable onPress={changePhoto} disabled={photoBusy} accessible={false} testID="profile-avatar" style={photoBusy ? styles.avatarBusy : undefined}>
            <Avatar name={account.displayName} size={72} uri={photo.uri} />
          </Pressable>
        ) : (
          <Avatar name={account.displayName} size={72} uri={photo?.uri ?? null} />
        )}
        {photo !== undefined && (
          <View style={styles.photoActions}>
            {photo.service.canChange && (
              <Pressable style={styles.photoButton} onPress={changePhoto} disabled={photoBusy} accessibilityRole="button" accessibilityLabel="Trocar foto">
                <Text style={styles.linkText}>Trocar foto</Text>
              </Pressable>
            )}
            {account.photoVersion != null && (
              <Pressable style={styles.photoButton} onPress={() => void removePhoto()} disabled={photoBusy} accessibilityRole="button" accessibilityLabel="Remover foto">
                <Text style={styles.removeText}>Remover foto</Text>
              </Pressable>
            )}
          </View>
        )}
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
        <Section title="Pedidos neste aparelho">
          <Pressable style={styles.link} onPress={onOpenLocalOrders} accessibilityRole="button" accessibilityLabel="Ver pedidos salvos neste aparelho">
            <Text style={styles.linkText}>Ver pedidos salvos neste aparelho</Text>
            {sync.status.pending > 0 ? <Text style={styles.linkHint}>{`${sync.status.pending} pendente(s)`}</Text> : <Icon name="arrow" color={colors.textMuted} size={18} />}
          </Pressable>
        </Section>
      )}

      <Section title="Configurações">
        <Text style={styles.muted}>Nenhuma configuração disponível nesta versão.</Text>
      </Section>

      {onCheckUpdate !== undefined && (
        <Section title="Atualização">
          <Pressable style={styles.link} onPress={() => void checkUpdate()} disabled={updating} accessibilityRole="button" accessibilityLabel="Verificar atualização do aplicativo">
            <Text style={styles.linkText}>{updating ? "Atualizando…" : "Verificar atualização"}</Text>
          </Pressable>
          {updateText !== null && <Text style={styles.muted} accessibilityLiveRegion="polite">{updateText}</Text>}
        </Section>
      )}

      <Section title="Sobre">
        <InfoRow label="Aplicativo" value={PRODUCT_NAME} />
        <InfoRow label="Versão" value={APP_BUILD_LABEL} />
        {APP_ENVIRONMENT_LABEL !== null && <InfoRow label="Ambiente" value={APP_ENVIRONMENT_LABEL} />}
      </Section>

      <Pressable style={styles.signOut} onPress={() => void confirmSignOut()} accessibilityRole="button" accessibilityLabel="Sair">
        <Text style={styles.signOutText}>Sair</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  identity: { alignItems: "center", gap: spacing.xs },
  avatarBusy: { opacity: 0.5 },
  photoActions: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.xs },
  photoButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  removeText: { fontSize: 15, fontWeight: "600", color: colors.red },
  name: { fontSize: 20, fontWeight: "800", color: colors.text },
  role: { fontSize: 14, color: colors.textMuted },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { fontSize: 14, color: colors.textMuted },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1, textAlign: "right" },
  muted: { fontSize: 14, color: colors.textMuted },
  link: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
  linkText: { fontSize: 15, fontWeight: "600", color: colors.navy },
  linkHint: { fontSize: 14, color: colors.textMuted },
  signOut: { borderWidth: 1, borderColor: colors.red, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  signOutText: { color: colors.red, fontSize: 15, fontWeight: "800" },
});
