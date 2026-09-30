import { useContext } from "react";
import { SafeAreaInsetsContext, type EdgeInsets } from "react-native-safe-area-context";

const NONE: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** System insets, or zero when no provider is mounted (component tests). */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? NONE;
}
