import { StyleSheet, View } from "react-native";

export type IconName = "home" | "customers" | "sales" | "catalog" | "profile";

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
