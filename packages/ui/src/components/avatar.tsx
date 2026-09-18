import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { initials } from "../lib/format";

export interface AvatarProps extends Omit<ComponentProps<"span">, "children"> {
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizes = { sm: "size-5 text-[8.5px]", md: "size-[26px] text-2xs", lg: "size-10 text-sm rounded-md" } as const;

/** Initials avatar (no remote images). The name is exposed as the accessible label. */
export function Avatar({ name, size = "md", className, ...props }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full border border-line-strong bg-surface-3 font-bold text-fg",
        sizes[size],
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}
