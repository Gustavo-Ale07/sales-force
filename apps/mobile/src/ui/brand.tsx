import { Image, StyleSheet, View } from "react-native";
import FORCE_ICON from "../../assets/brand/icon-p.png";
import { colors } from "../theme";

// The round P symbol, the same file the web app ships (apps/web/public/brand/icon-p.png, 512 x 512, transparent corners).

/** Force symbol at a given height; the image is square. */
export function BrandLogo({ height = 40 }: { height?: number }) {
  return <Image source={FORCE_ICON} style={{ height, width: height }} resizeMode="contain" accessibilityLabel="Force" />;
}

/** Start-up screen: the brand alone, no text and no animation. */
export function SplashView() {
  return (
    <View style={styles.splash} accessibilityLabel="Force">
      <BrandLogo height={96} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
