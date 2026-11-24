import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import FOOTER_ART from "../../assets/login/login-footer-art.png";
import { Icon } from "./icons";

/**
 * Login decoration and field icons. The footer art is the exact SVG of the web login panel (assets/login/login-footer-art.svg, rendered
 * to PNG 1x/2x/3x), shown with the core Image: no react-native-svg, no native module, reaches devices by OTA. Tagline and red dash stay as text/view.
 */

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
        <Image
          testID="login-art"
          source={FOOTER_ART}
          style={styles.art}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
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
  art: { width: "100%", aspectRatio: 518 / 261, maxHeight: 161 },
  tagline: { fontSize: 12, fontWeight: "500", color: "#2d3860", letterSpacing: 4, lineHeight: 18, textAlign: "center", marginTop: 8 },
  dash: { width: 44, height: 3, backgroundColor: colors.red, marginTop: 10, marginBottom: 12 },
});
