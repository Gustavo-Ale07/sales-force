import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { initials } from "../lib/format";

export interface AvatarProps extends Omit<ComponentProps<"span">, "children"> {
  name: string;
  size?: "sm" | "md" | "lg";
  /**
   * Identifier the colour is hashed from (e.g. a customer or user code). Defaults to `name`; pass a
   * stable id when two different accounts can share a display name, so they don't collide on colour.
   */
  seed?: string;
}

const sizes = { sm: "size-6 text-[9px]", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

// Non-alarming tones only: identity colour must never be mistaken for a status signal (danger/warning are
// reserved for StatusBadge/Alert). Picked deterministically so the same person/account always reads the same
// colour across screens, which is the point (faster scanning of lists), not a random per-render accent.
const IDENTITY_TONES = [
  "bg-accent-weak text-accent-text",
  "bg-ok-bg text-ok",
  "bg-info-bg text-info",
  "bg-neutral-bg text-neutral",
] as const;

function hashTone(seed: string): (typeof IDENTITY_TONES)[number] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) | 0;
  return IDENTITY_TONES[Math.abs(hash) % IDENTITY_TONES.length]!;
}

/** Initials avatar (no remote images), coloured deterministically from `seed`/`name`. The name is the accessible label. */
export function Avatar({ name, size = "md", seed, className, ...props }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        hashTone(seed ?? (name || "?")),
        sizes[size],
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}
