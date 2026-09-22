/**
 * Installation brand (PROD-1): logo, mark and accent color come from the runtime configuration, never from
 * the source. `/config.json` is public and editable per installation, so every value is validated here
 * before it reaches the DOM: assets are same-origin files under `/brand/` with an image extension, and the
 * accent is a plain `#rrggbb` that keeps white text readable (WCAG AA). Anything else falls back to the
 * default look; nothing here ever throws.
 */
export interface Brand {
  /** Horizontal logo (sidebar, login). */
  logoUrl: string | null;
  /** Square mark (collapsed spaces, favicon). */
  markUrl: string | null;
  /** Accent color, `#rrggbb`. */
  accent: string | null;
}

export const defaultBrand: Brand = { logoUrl: null, markUrl: null, accent: null };

// A flat file name (no sub-folders, so no path tricks) under /brand/, image extensions only.
const BRAND_ASSET = /^\/brand\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,80}\.(?:png|svg|webp|jpe?g)$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_CONTRAST_WITH_WHITE = 5.5;

export function parseBrandAsset(value: unknown): string | null {
  return typeof value === "string" && BRAND_ASSET.test(value) ? value : null;
}

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of a `#rrggbb` color against white. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(toRgb(hex)) + 0.05);
}

/** A valid accent (lowercase `#rrggbb`) that carries white text at AA, or `null`. */
export function parseAccent(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
  const hex = value.toLowerCase();
  return contrastWithWhite(hex) >= MIN_CONTRAST_WITH_WHITE ? hex : null;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** The accent family the design system uses (`--sf-accent*`), derived from one configured color. */
export function deriveAccentTokens(accent: string): { accent: string; hover: string; weak: string; text: string } {
  const base = toRgb(accent);
  return {
    accent,
    hover: toHex(mix(base, BLACK, 0.12)),
    weak: toHex(mix(base, WHITE, 0.89)),
    text: toHex(mix(base, BLACK, 0.3)),
  };
}

/** Applies the brand to the document: accent tokens via the style object (never markup) and the favicon. */
export function applyBrand(brand: Brand, root: HTMLElement = document.documentElement): void {
  if (brand.accent !== null) {
    const tokens = deriveAccentTokens(brand.accent);
    root.style.setProperty("--sf-accent", tokens.accent);
    root.style.setProperty("--sf-accent-hover", tokens.hover);
    root.style.setProperty("--sf-accent-weak", tokens.weak);
    root.style.setProperty("--sf-accent-text", tokens.text);
  }
  if (brand.markUrl !== null) {
    const icon = root.ownerDocument.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = brand.markUrl;
  }
}
