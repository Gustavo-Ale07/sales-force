import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends ComponentProps<"section"> {
  /**
   * Marks the card as an action/navigation surface (e.g. the login panel, a future clickable summary
   * tile): it gains resting elevation (`--sf-shadow-1`) and an accent glow (`--sf-shadow-glow`) plus a
   * tinted border on hover/focus-within, eased with `--sf-ease-spring`. Cards that only contain a data
   * table or a key/value list (the majority of this app) stay flat — elevation reads as "you can act on
   * this", not "here is information".
   */
  interactive?: boolean;
}

/** Panel/surface: white, 1px border, small radius. Flat by default; see `interactive` for action surfaces. */
export function Card({ className, interactive = false, ...props }: CardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-line bg-surface transition-opacity duration-[var(--sf-dur-base)] aria-busy:opacity-70",
        interactive &&
          "shadow-card transition-[box-shadow,border-color,transform] duration-[var(--sf-dur-base)] ease-spring hover:border-line-strong hover:shadow-pop focus-within:border-accent/50",
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<"div">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions or links. */
  actions?: ReactNode;
  /** Heading level for the title (default h2). */
  as?: "h2" | "h3" | "h4";
}

export function CardHeader({ title, description, actions, as: Heading = "h2", className, ...props }: CardHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-5 py-3.5", className)} {...props}>
      <div className="min-w-0">
        <Heading className="m-0 text-[15px] font-semibold text-fg">{title}</Heading>
        {description ? <p className="m-0 mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 text-xs">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-fg-muted", className)} {...props} />;
}

export interface KeyValueProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label/value row for detail panels; wrap several in `<dl>` via KeyValueList. */
export function KeyValue({ label, children, className }: KeyValueProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0", className)}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}

export function KeyValueList({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("m-0", className)} {...props} />;
}
