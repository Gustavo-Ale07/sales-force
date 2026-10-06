import type { ApiSchema } from "@salesforce/contracts/client";
import { useState } from "react";

type ProductImageMeta = ApiSchema<"ProductImage">;
export type ProductImageVariant = "thumb" | "full";

const SIZES = { thumb: 40, full: 224 } as const;

/**
 * Same-origin, server-built relative URL with the opaque `version` as cache buster.
 * Anything that is not a plain same-origin path (absolute, protocol-relative, data:) is refused,
 * so the strict CSP `img-src 'self'` never needs to be loosened.
 */
export function productImageSrc(image: ProductImageMeta, variant: ProductImageVariant): string | null {
  const base = variant === "thumb" ? image.thumbnailUrl : image.url;
  if (!base.startsWith("/") || base.startsWith("//")) return null;
  return `${base}${base.includes("?") ? "&" : "?"}v=${encodeURIComponent(image.version)}`;
}

function initials(text: string): string {
  const words = text.split(/\s+/).filter((w) => /^\p{L}|^\p{N}/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toLocaleUpperCase("pt-BR"))
    .join("");
}

export interface ProductImageProps {
  image?: ProductImageMeta | null;
  /** Product description: used as the alt text and for the placeholder initials. */
  description: string;
  /** Display name for the initials (defaults to the description). */
  name?: string;
  variant?: ProductImageVariant;
  className?: string;
}

export function ProductImage({ image, description, name, variant = "thumb", className }: ProductImageProps) {
  // The failure is remembered for the exact src: a new version (new src) is tried again.
  // No fallback to the full original: the server generates a thumbnail for every photo, and the
  // original must never be shipped into list boxes. A failed request shows the initials placeholder.
  const [failed, setFailed] = useState<string[]>([]);
  const primary = image ? productImageSrc(image, variant) : null;
  const src = primary !== null && !failed.includes(primary) ? primary : null;
  const size = SIZES[variant];
  const box = `${variant === "thumb" ? "rounded" : "rounded-md"} border border-line bg-surface-2 shrink-0 ${className ?? ""}`;

  if (src) {
    return (
      <img
        src={src}
        alt={description}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed((current) => [...current, src])}
        className={`${box} object-contain`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex select-none items-center justify-center text-xs font-medium text-fg-muted`}
      style={{ width: size, height: size }}
    >
      {initials(name ?? description)}
    </span>
  );
}
