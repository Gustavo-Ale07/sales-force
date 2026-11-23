import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useReduceMotion } from "./sync-icon";

const HEAD_W = 7;
const HEAD_H = 6;

/** Arrowhead centred on the circle at `angle` (degrees, 0 = right, clockwise, y down), pointing clockwise along the tangent. */
function Head({ angle, radius, center, color }: { angle: number; radius: number; center: number; color: string }) {
  const rad = (angle * Math.PI) / 180;
  const x = center + radius * Math.cos(rad);
  const y = center + radius * Math.sin(rad);
  return (
    <View
      style={{
        position: "absolute",
        left: x - HEAD_W / 2,
        top: y - HEAD_H / 2,
        width: 0,
        height: 0,
        borderLeftWidth: HEAD_W / 2,
        borderRightWidth: HEAD_W / 2,
        borderBottomWidth: HEAD_H,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: color,
        transform: [{ rotate: `${angle + 180}deg` }],
      }}
    />
  );
}

/**
 * Two symmetric circular arcs with an arrowhead each (the classic "refresh" glyph), drawn with plain views like the other icons.
 * Spins while `spinning` (static when the system asks to reduce motion).
 */
export function RefreshArrows({ color, size = 24, spinning = false, testID }: { color: string; size?: number; spinning?: boolean; testID?: string }) {
  const reduceMotion = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(0));
  const spin = spinning && !reduceMotion;
  useEffect(() => {
    if (!spin) {
      turn.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, turn]);

  const stroke = Math.max(2, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, { transform: [{ rotate }] }]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, borderWidth: stroke, borderColor: "transparent", borderTopColor: color, borderBottomColor: color },
        ]}
      />
      <Head angle={-45} radius={radius} center={center} color={color} />
      <Head angle={135} radius={radius} center={center} color={color} />
    </Animated.View>
  );
}
