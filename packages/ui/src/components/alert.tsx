import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<AlertTone, string> = {
  info: "border-info bg-info-bg [&_.sf-alert-icon]:text-info",
  success: "border-ok bg-ok-bg [&_.sf-alert-icon]:text-ok",
  warning: "border-warn bg-warn-bg [&_.sf-alert-icon]:text-warn",
  danger: "border-danger bg-danger-bg [&_.sf-alert-icon]:text-danger",
  neutral: "border-line-strong bg-surface-2 text-fg-muted [&_.sf-alert-icon]:text-fg-muted",
};

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
  neutral: Info,
} as const;

export interface AlertProps extends Omit<ComponentProps<"div">, "title"> {
  tone?: AlertTone;
  title?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned action (button/link). */
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** `banner` = full-width, square, for page-level notices (e.g. non-production environment). */
  variant?: "inline" | "banner";
}

/** Inline alert or page banner. Danger/warning use role="alert"; others role="status". */
export function Alert({
  tone = "info",
  title,
  icon,
  action,
  onDismiss,
  dismissLabel = "Dispensar",
  variant = "inline",
  className,
  children,
  role,
  ...props
}: AlertProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={role ?? (tone === "danger" || tone === "warning" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-2 border px-3 py-2 text-sm text-fg",
        variant === "banner" ? "rounded-none border-x-0 border-t-0 border-b py-1.5 text-xs" : "rounded-md border-l-[3px]",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <span className="sf-alert-icon mt-0.5 flex shrink-0">{icon ?? <Icon size={15} aria-hidden="true" />}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="m-0 font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "text-fg-muted")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Page-level banner alias. */
export function Banner(props: Omit<AlertProps, "variant">) {
  return <Alert variant="banner" {...props} />;
}
