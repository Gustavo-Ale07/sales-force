import { Pressable, StyleSheet, Text, View } from "react-native";
import { useInsets } from "./use-insets";
import { colors } from "../theme";
import { Icon, type IconName } from "./icons";

export type MainTab = "home" | "customers" | "sales" | "catalog" | "profile";

export const MAIN_TABS: readonly { readonly key: MainTab; readonly label: string; readonly icon: IconName }[] = [
  { key: "home", label: "Início", icon: "home" },
  { key: "customers", label: "Clientes", icon: "customers" },
  { key: "sales", label: "Vendas", icon: "sales" },
  { key: "catalog", label: "Catálogo", icon: "catalog" },
  { key: "profile", label: "Perfil", icon: "profile" },
];

/** Fixed bottom navigation. It pads itself with the system inset, so it clears the Android navigation bar and gesture area. */
export function BottomNav({ active, onSelect, badges = {} }: { active: MainTab; onSelect: (tab: MainTab) => void; badges?: Partial<Record<MainTab, boolean>> }) {
  const insets = useInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {MAIN_TABS.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? colors.navy : colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            style={styles.item}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
          >
            <View style={[styles.indicator, selected && styles.indicatorActive]} />
            <View>
              <Icon name={tab.icon} color={color} />
              {badges[tab.key] === true && <View style={styles.badge} />}
            </View>
            <Text style={[styles.label, { color }, selected && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  item: { flex: 1, alignItems: "center", minHeight: 56, paddingBottom: 6, gap: 2 },
  indicator: { alignSelf: "stretch", height: 3, marginBottom: 6, backgroundColor: "transparent" },
  indicatorActive: { backgroundColor: colors.red },
  label: { fontSize: 11, fontWeight: "600" },
  labelActive: { fontWeight: "800" },
  badge: { position: "absolute", top: -1, right: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.red, borderWidth: 1, borderColor: colors.surface },
});
