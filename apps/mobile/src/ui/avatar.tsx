import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { initialsOf } from "./account-labels";
import type { ProfilePhotoStore } from "../photo/profile-photo-store";

/** The account's photo (a file already on the device) or, without one, the initials. */
export function Avatar({ name, size, uri, onNavy = false }: { name: string; size: number; uri?: string | null; onNavy?: boolean }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const shown = uri !== undefined && uri !== null && uri !== failedUri ? uri : null;
  const frame = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      style={[styles.frame, frame, onNavy ? styles.onNavy : styles.onLight]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="avatar"
    >
      {shown === null ? (
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.36), color: onNavy ? colors.navy : colors.onNavy }]} testID="avatar-initials">
          {initialsOf(name)}
        </Text>
      ) : (
        <Image source={{ uri: shown }} style={frame} resizeMode="cover" onError={() => setFailedUri(shown)} testID="avatar-image" />
      )}
    </View>
  );
}

/** The photo file of the account at `version`: downloaded once per version with the session, then read from the device. */
export function useProfilePhotoUri(store: ProfilePhotoStore | undefined, accountId: string, version: string | null | undefined, online: boolean): string | null {
  const [resolved, setResolved] = useState<{ readonly key: string; readonly uri: string | null } | null>(null);
  const key = `${accountId}|${version ?? ""}`;
  useEffect(() => {
    if (store === undefined || version === null || version === undefined) return undefined;
    const controller = new AbortController();
    void store.resolve(accountId, version, { online, signal: controller.signal }).then((uri) => {
      if (!controller.signal.aborted) setResolved({ key, uri });
    });
    return () => controller.abort();
  }, [store, accountId, version, online, key]);
  return resolved !== null && resolved.key === key ? resolved.uri : null;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  onLight: { backgroundColor: colors.navy },
  onNavy: { backgroundColor: colors.onNavy },
  initials: { fontWeight: "800" },
});
