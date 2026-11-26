import { StyleSheet, View } from "react-native";

export type IconName = "home" | "customers" | "sales" | "catalog" | "profile" | "products" | "cart" | "check" | "close" | "select" | "plus" | "arrow" | "back" | "alert" | "filter" | "cloud" | "search";

/** Small line icons drawn with plain views: no icon font or SVG dependency. All fit a 24 x 24 box. */
export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const box = { width: size, height: size };
  const stroke = { borderColor: color, borderWidth: 2 };
  switch (name) {
    case "home":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.roof, { borderBottomColor: color }]} />
          <View style={[styles.houseBody, stroke]} />
        </View>
      );
    case "customers":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.head, stroke]} />
          <View style={[styles.shoulders, stroke]} />
        </View>
      );
    case "sales":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.sheet, stroke]}>
            <View style={[styles.line, { backgroundColor: color }]} />
            <View style={[styles.line, { backgroundColor: color }]} />
            <View style={[styles.lineShort, { backgroundColor: color }]} />
          </View>
        </View>
      );
    case "catalog":
      return (
        <View style={[box, styles.grid]}>
          {[0, 1, 2, 3].map((cell) => (
            <View key={cell} style={[styles.cell, stroke]} />
          ))}
        </View>
      );
    case "products":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.crate, stroke]}>
            <View style={[styles.crateLine, { backgroundColor: color }]} />
          </View>
        </View>
      );
    case "cart":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.cartHandle, { backgroundColor: color }]} />
          <View style={[styles.cartBody, stroke]} />
          <View style={styles.wheels}>
            <View style={[styles.wheel, { backgroundColor: color }]} />
            <View style={[styles.wheel, { backgroundColor: color }]} />
          </View>
        </View>
      );
    case "check":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.tick, { borderColor: color }]} />
        </View>
      );
    case "close":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.bar, { backgroundColor: color, transform: [{ rotate: "45deg" }] }]} />
          <View style={[styles.bar, styles.barCross, { backgroundColor: color, transform: [{ rotate: "-45deg" }] }]} />
        </View>
      );
    case "select":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.selectBox, stroke]}>
            <View style={[styles.tickSmall, { borderColor: color }]} />
          </View>
        </View>
      );
    case "plus":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.bar, { backgroundColor: color }]} />
          <View style={[styles.bar, { backgroundColor: color, transform: [{ rotate: "90deg" }] }]} />
        </View>
      );
    case "arrow":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.arrowShaft, { backgroundColor: color }]} />
          <View style={[styles.arrowHead, { borderColor: color }]} />
        </View>
      );
    case "back":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.chevron, { borderColor: color }]} />
        </View>
      );
    case "alert":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.alertBar, { backgroundColor: color }]} />
          <View style={[styles.alertDot, { backgroundColor: color }]} />
        </View>
      );
    case "filter":
      return (
        <View style={[box, styles.center]} accessibilityElementsHidden>
          <View style={[styles.filterBar, { backgroundColor: color, width: 18 }]} />
          <View style={[styles.filterBar, { backgroundColor: color, width: 12 }]} />
          <View style={[styles.filterBar, { backgroundColor: color, width: 6 }]} />
        </View>
      );
    case "search":
      return (
        <View style={[box, styles.center]} accessibilityElementsHidden>
          <View style={[styles.lensRing, stroke]} />
          <View style={[styles.lensHandle, { backgroundColor: color }]} />
        </View>
      );
    case "cloud":
      return (
        <View style={[box, styles.center]} accessibilityElementsHidden>
          <View style={[styles.cloudBody, stroke]} />
          <View style={[styles.cloudPuff, stroke, { backgroundColor: "transparent" }]} />
        </View>
      );
    case "profile":
      return (
        <View style={[box, styles.center]}>
          <View style={[styles.circle, stroke]}>
            <View style={[styles.miniHead, { backgroundColor: color }]} />
            <View style={[styles.miniBody, { backgroundColor: color }]} />
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  filterBar: { height: 2, borderRadius: 1, marginVertical: 2 },
  lensRing: { position: "absolute", top: 2, left: 2, width: 15, height: 15, borderRadius: 8 },
  lensHandle: { position: "absolute", bottom: 3, right: 3, width: 8, height: 2, borderRadius: 1, transform: [{ rotate: "45deg" }] },
  cloudBody: { width: 20, height: 11, borderRadius: 6, marginTop: 6 },
  cloudPuff: { position: "absolute", top: 3, left: 6, width: 10, height: 10, borderRadius: 5, borderBottomColor: "transparent" },
  crate: { width: 18, height: 16, borderRadius: 3, justifyContent: "center" },
  crateLine: { height: 2 },
  cartHandle: { position: "absolute", top: 3, left: 1, width: 5, height: 2, borderRadius: 1 },
  cartBody: { width: 16, height: 9, borderRadius: 2, marginTop: -3, marginLeft: 3 },
  wheels: { position: "absolute", bottom: 2, left: 6, flexDirection: "row", gap: 6 },
  wheel: { width: 4, height: 4, borderRadius: 2 },
  tick: { width: 7, height: 12, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 2, borderBottomWidth: 2, transform: [{ rotate: "45deg" }], marginTop: -2 },
  tickSmall: { width: 4, height: 8, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 2, borderBottomWidth: 2, transform: [{ rotate: "45deg" }], marginTop: -2 },
  selectBox: { width: 18, height: 18, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  bar: { position: "absolute", width: 18, height: 2, borderRadius: 1 },
  arrowShaft: { position: "absolute", width: 16, height: 2, borderRadius: 1 },
  arrowHead: { position: "absolute", right: 3, width: 9, height: 9, borderTopWidth: 2, borderRightWidth: 2, borderLeftWidth: 0, borderBottomWidth: 0, transform: [{ rotate: "45deg" }] },
  chevron: { width: 10, height: 10, borderLeftWidth: 2, borderBottomWidth: 2, borderTopWidth: 0, borderRightWidth: 0, transform: [{ rotate: "45deg" }], marginLeft: 3 },
  alertBar: { width: 3, height: 11, borderRadius: 2 },
  alertDot: { width: 3, height: 3, borderRadius: 2, marginTop: 2 },
  barCross: {},
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  houseBody: { width: 16, height: 10, borderTopWidth: 0, marginTop: -1 },
  head: { width: 9, height: 9, borderRadius: 5 },
  shoulders: { width: 18, height: 9, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomWidth: 0, marginTop: 2 },
  sheet: { width: 16, height: 20, borderRadius: 3, paddingHorizontal: 2, paddingTop: 3, gap: 3 },
  line: { height: 2, borderRadius: 1 },
  lineShort: { height: 2, width: "55%", borderRadius: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap: 2 },
  cell: { width: 9, height: 9, borderRadius: 2 },
  circle: { width: 22, height: 22, borderRadius: 11, alignItems: "center", overflow: "hidden" },
  miniHead: { width: 7, height: 7, borderRadius: 4, marginTop: 3 },
  miniBody: { width: 14, height: 9, borderRadius: 7, marginTop: 1 },
});
