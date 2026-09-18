import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/cn";

export function Label({ className, ...props }: ComponentProps<"label">) {
  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- association comes from htmlFor supplied by callers
  return <label className={cn("text-xs font-semibold text-fg-muted", className)} {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs font-semibold text-danger", className)} {...props} />;
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-fg-muted", className)} {...props} />;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

export interface FormFieldProps {
  label: ReactNode;
  /** Optional element shown at the right of the label row (e.g. a link). */
  labelAside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  /** A single control element (cloned with id/aria props) or a render function receiving them. */
  children: ReactElement<Partial<FieldControlProps>> | ((props: FieldControlProps) => ReactNode);
}

/**
 * Label + control + hint + error with correct id/aria wiring (WCAG 1.3.1, 3.3.1, 3.3.2).
 * Required fields are marked visually with an asterisk and semantically with aria-required.
 */
export function FormField({ label, labelAside, hint, error, required, id, className, children }: FormFieldProps) {
  const autoId = useId();
  const controlId = id ?? `f-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const controlProps: FieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    "aria-required": required || undefined,
  };
  const control =
    typeof children === "function" ? children(controlProps) : isValidElement(children) ? cloneElement(children, controlProps) : children;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          ) : null}
        </Label>
        {labelAside}
      </div>
      {control}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  );
}
