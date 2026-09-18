import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:border-line disabled:bg-surface-2 disabled:text-fg-faint aria-disabled:pointer-events-none aria-disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover",
        secondary: "border-line-strong bg-surface text-fg hover:bg-surface-2",
        ghost: "border-transparent bg-transparent text-fg-muted hover:bg-surface-3 hover:text-fg",
        danger: "border-danger bg-danger text-on-accent hover:opacity-90",
        "danger-outline": "border-danger bg-surface text-danger hover:bg-danger-bg",
      },
      size: {
        sm: "h-[26px] px-2 text-xs",
        md: "h-[30px] px-3 text-sm",
        lg: "h-9 px-4 text-base",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", block: false },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Shows a spinner, disables interaction and sets aria-busy. */
  loading?: boolean;
  /** Content shown while loading (defaults to the children). */
  loadingText?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Render the styles onto the child element (e.g. a router link). */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  loading = false,
  loadingText,
  leftIcon,
  rightIcon,
  asChild = false,
  disabled,
  children,
  type,
  ref,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, block }), className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...(props as ComponentProps<typeof Slot.Root>)}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : leftIcon}
      {loading && loadingText !== undefined ? loadingText : children}
      {loading ? null : rightIcon}
    </button>
  );
}

const iconButtonSizes = { sm: "size-[26px]", md: "size-[30px]", lg: "size-9" } as const;

export interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label" | "children"> {
  /** Required accessible name (icon-only control). */
  label: string;
  icon: ReactNode;
  variant?: "secondary" | "ghost" | "primary" | "danger-outline";
  size?: keyof typeof iconButtonSizes;
}

export function IconButton({ label, icon, variant = "ghost", size = "md", className, type, ref, ...props }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant, size: "sm" }), "px-0", iconButtonSizes[size], className)}
      {...props}
    >
      {icon}
    </button>
  );
}
