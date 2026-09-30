import { Image, StyleSheet, View } from "react-native";
import PLAC_LOGO from "../../assets/brand/plac-logo.png";
import { colors } from "../theme";

// The real PLAC mark, the same file the web app ships (apps/web/public/brand/plac-logo.png, 2665 x 840).
const LOGO_RATIO = 2665 / 840;

/** PLAC logo at a given height, keeping the source aspect ratio. */
export function BrandLogo({ height = 40 }: { height?: number }) {
  return <Image source={PLAC_LOGO} style={{ height, width: height * LOGO_RATIO }} resizeMode="contain" accessibilityLabel="PLAC" />;
}

/** Start-up screen: the brand alone, no text and no animation. */
export function SplashView() {
  return (
    <View style={styles.splash} accessibilityLabel="Force">
      <BrandLogo height={56} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
