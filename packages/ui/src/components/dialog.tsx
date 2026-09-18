import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof RadixDialog.Overlay>) {
  return <RadixDialog.Overlay className={cn("fixed inset-0 z-40 animate-sf-fade-in bg-scrim", className)} {...props} />;
}

export interface DialogContentProps extends Omit<ComponentProps<typeof RadixDialog.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Footer actions (buttons). */
  footer?: ReactNode;
  closeLabel?: string;
}

/** Modal dialog: focus trap, Escape to close, focus returns to the trigger (Radix). Title is required. */
export function DialogContent({ title, description, footer, closeLabel = "Fechar", className, children, ...props }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 animate-sf-fade-in flex-col rounded-lg border border-line-strong bg-surface shadow-pop",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <RadixDialog.Title className="m-0 text-base font-semibold text-fg">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="m-0 mt-0.5 text-xs text-fg-muted">{description}</RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close
            aria-label={closeLabel}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
          >
            <X size={15} aria-hidden="true" />
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div> : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
