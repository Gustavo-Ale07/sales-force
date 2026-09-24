/**
 * PLAC identity for the mobile app. Values mirror the design tokens of the web app (`--sf-*` in
 * `packages/ui`); the mobile app may not depend on `packages/ui` (architecture.md section 4.2), so the few
 * needed tokens are repeated here. Never Vidya branding.
 */
export const colors = {
  navy: "#001369",
  navyStrong: "#000d4d",
  red: "#d10108",
  background: "#f4f5f9",
  surface: "#ffffff",
  border: "#dde1e8",
  text: "#12172a",
  textMuted: "#4a5268",
  onNavy: "#ffffff",
  ok: "#17693d",
  warning: "#8a4b00",
  errorBackground: "#ffe6e6",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
