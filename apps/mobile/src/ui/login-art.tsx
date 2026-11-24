import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { Icon } from "./icons";

/**
 * Login decoration and field icons. react-native-svg is not part of the installed app, so (like icons.tsx) everything is drawn with
 * plain views: the same composition as the footer of the web login panel (petal cup with truffle, folded wrapper, gift box with bow,
 * light line over a soft wave) and the same tagline with the red dash. Reaches devices by OTA: no native module.
 */
const LINE = "#cfd5e3";
const W = 1.5;

export type FieldIconName = "user" | "lock" | "eye" | "eyeOff";

export function FieldIcon({ name, color, size = 22 }: { name: FieldIconName; color: string; size?: number }) {
  const box = { width: size, height: size };
  const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const;
  switch (name) {
    case "user":
      return (
        <View style={box} {...hidden}>
          <Icon name="customers" color={color} size={size} />
        </View>
      );
    case "lock":
      return (
        <View style={[box, styles.center]} {...hidden}>
          <View style={[styles.shackle, { borderColor: color }]} />
          <View style={[styles.lockBody, { borderColor: color }]}>
            <View style={[styles.keyhole, { backgroundColor: color }]} />
          </View>
        </View>
      );
    case "eye":
    case "eyeOff":
      return (
        <View style={[box, styles.center]} {...hidden}>
          <View style={[styles.eye, { borderColor: color }]}>
            <View style={[styles.pupil, { backgroundColor: color }]} />
          </View>
          {name === "eyeOff" && <View style={[styles.slash, { backgroundColor: color }]} />}
        </View>
      );
  }
}

export function LoginArt({ showArt }: { showArt: boolean }) {
  return (
    <View style={styles.footer} pointerEvents="none">
      {showArt && (
        <View style={styles.art} testID="login-art" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.wave} />
          <View style={styles.scene}>
            {/* petal cup with truffle */}
            <View style={[styles.petal, { left: 18, height: 34, width: 26 }]} />
            <View style={[styles.petal, { left: 40, height: 44, width: 34 }]} />
            <View style={[styles.petal, { left: 70, height: 34, width: 26 }]} />
            <View style={styles.truffle} />
            {/* folded wrapper */}
            <View style={styles.wrapper} />
            {/* gift box with bow */}
            <View style={styles.boxLid} />
            <View style={styles.boxBody} />
            <View style={styles.ribbon} />
            <View style={[styles.bow, { left: 220, transform: [{ rotate: "-20deg" }] }]} />
            <View style={[styles.bow, { left: 236, transform: [{ rotate: "20deg" }] }]} />
          </View>
        </View>
      )}
      <Text style={styles.tagline}>{"ARTIGOS PARA FESTAS\n& CONFEITARIA"}</Text>
      <View style={styles.dash} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  shackle: { position: "absolute", top: 1, width: 12, height: 11, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  lockBody: { width: 17, height: 12, borderWidth: 2, borderRadius: 3, marginTop: 6, alignItems: "center", justifyContent: "center" },
  keyhole: { width: 3, height: 3, borderRadius: 2 },
  eye: { width: 22, height: 14, borderWidth: 2, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  pupil: { width: 6, height: 6, borderRadius: 3 },
  slash: { position: "absolute", width: 26, height: 2, borderRadius: 1, transform: [{ rotate: "-40deg" }] },
  footer: { alignItems: "center", justifyContent: "flex-end", flexGrow: 1, paddingTop: 8 },
  art: { width: "100%", height: 110, alignItems: "center", justifyContent: "flex-end", overflow: "hidden" },
  wave: { position: "absolute", left: -40, right: -40, bottom: 0, height: 70, borderTopLeftRadius: 400, borderTopRightRadius: 400, backgroundColor: "#f4f7fc" },
  scene: { width: 290, height: 100 },
  petal: { position: "absolute", bottom: 22, borderWidth: W, borderColor: LINE, borderBottomWidth: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  truffle: { position: "absolute", left: 26, bottom: 4, width: 62, height: 36, borderRadius: 18, borderWidth: W, borderColor: LINE },
  wrapper: { position: "absolute", left: 130, bottom: 8, width: 34, height: 34, borderWidth: W, borderColor: LINE, borderRadius: 6, transform: [{ rotate: "12deg" }] },
  boxLid: { position: "absolute", left: 196, bottom: 40, width: 74, height: 16, borderWidth: W, borderColor: LINE, borderRadius: 3 },
  boxBody: { position: "absolute", left: 202, bottom: 4, width: 62, height: 36, borderWidth: W, borderColor: LINE },
  ribbon: { position: "absolute", left: 232, bottom: 4, width: W, height: 52, backgroundColor: LINE },
  bow: { position: "absolute", bottom: 56, width: 16, height: 10, borderWidth: W, borderColor: LINE, borderRadius: 8 },
  tagline: { fontSize: 12, fontWeight: "500", color: "#2d3860", letterSpacing: 4, lineHeight: 18, textAlign: "center", marginTop: 8 },
  dash: { width: 44, height: 3, backgroundColor: colors.red, marginTop: 10, marginBottom: 12 },
});
