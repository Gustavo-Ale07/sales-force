import { Check, Minus } from "lucide-react";
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CheckboxProps extends ComponentProps<typeof RadixCheckbox.Root> {
  /** Visible label; when omitted provide aria-label. */
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ className, label, description, id, ...props }: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? `cb-${autoId}`;
  const box = (
    <RadixCheckbox.Root
      id={controlId}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface text-on-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        {props.checked === "indeterminate" ? (
          <Minus size={12} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check size={12} strokeWidth={3} aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-[3px] flex">{box}</span>
      <label htmlFor={controlId} className="flex flex-col text-sm text-fg">
        {label}
        {description ? <span className="text-xs text-fg-muted">{description}</span> : null}
      </label>
    </div>
  );
}

export interface SwitchProps extends ComponentProps<typeof RadixSwitch.Root> {
  label?: ReactNode;
}

export function Switch({ className, label, id, ...props }: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? `sw-${autoId}`;
  const control = (
    <RadixSwitch.Root
      id={controlId}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block size-2.5 translate-x-[2px] rounded-full bg-fg-muted transition-transform data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-on-accent" />
    </RadixSwitch.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-center gap-2">
      {control}
      <label htmlFor={controlId} className="text-sm text-fg">
        {label}
      </label>
    </div>
  );
}
