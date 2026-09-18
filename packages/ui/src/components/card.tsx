import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/** Panel/surface: white, 1px border, small radius, no heavy shadow. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("min-w-0 rounded-md border border-line bg-surface", className)} {...props} />;
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
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-3 py-2", className)} {...props}>
      <div className="min-w-0">
        <Heading className="m-0 text-sm font-semibold text-fg">{title}</Heading>
        {description ? <p className="m-0 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 text-xs">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-3 py-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-fg-muted", className)} {...props} />;
}

export interface KeyValueProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label/value row for detail panels; wrap several in `<dl>` via KeyValueList. */
export function KeyValue({ label, children, className }: KeyValueProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-dashed border-line py-1.5 last:border-b-0", className)}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}

export function KeyValueList({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("m-0", className)} {...props} />;
}
