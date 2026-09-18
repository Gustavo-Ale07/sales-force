import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-bg text-neutral",
  accent: "bg-accent-weak text-accent-text",
  success: "bg-ok-bg text-ok",
  warning: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

export const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap font-medium", {
  variants: {
    tone: toneClasses,
    shape: {
      /** Compact rectangular tag (categories, flags). */
      tag: "rounded-sm border border-current/20 px-1.5 text-2xs leading-4",
      /** Status pill with leading dot. */
      pill: "rounded-full px-2 text-2xs leading-[18px]",
    },
  },
  defaultVariants: { tone: "neutral", shape: "tag" },
});

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, shape, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, shape }), className)} {...props} />;
}

export interface StatusBadgeProps extends Omit<ComponentProps<"span">, "children"> {
  tone?: Tone;
  children: string;
}

/**
 * Semantic status (order/customer/integration state). Colour is never the only signal: the text label is
 * always rendered and the dot is decorative. The mapping status -> tone belongs to the screen using it.
 */
export function StatusBadge({ tone = "neutral", className, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, shape: "pill" }), className)} {...props}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
