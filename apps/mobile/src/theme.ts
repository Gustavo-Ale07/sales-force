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
  /** Amber: a discount above the product's registered limit (a warning, never an error). */
  amber: "#b45309",
  amberBackground: "#fff4dc",
  amberBorder: "#f0b429",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** One corner radius for cards, fields, buttons and tabs (a second one only for pills/badges). */
export const radius = { md: 8, pill: 999 } as const;

/** One height for every touch control of a row (search field, segmented control, filter button, secondary buttons); also the minimum touch target. */
export const control = { height: 44, heightLarge: 48 } as const;

/** App header: fixed content height (the status bar inset is added on top); holds the 44 px indicator centered with the logo. */
export const HEADER_HEIGHT = 52;

/** Font sizes in use: a short scale instead of ad-hoc values. */
export const fontSize = { caption: 12, body: 14, bodyLarge: 16, title: 20, headline: 24 } as const;
