import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof RadixDialog.Overlay>) {
  return <RadixDialog.Overlay className={cn("fixed inset-0 z-40 animate-sf-fade-in bg-scrim data-[state=closed]:animate-sf-fade-out", className)} {...props} />;
}

export interface DialogContentProps extends Omit<ComponentProps<typeof RadixDialog.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Footer actions (buttons). */
  footer?: ReactNode;
  closeLabel?: string;
  /**
   * Default true. `false` makes a blocking progress dialog: no X, dimmed and slightly blurred backdrop, initial focus on
   * the dialog itself (never on a control), focus ring only for the keyboard (:focus-visible).
   */
  dismissible?: boolean;
}

/** Modal dialog: focus trap, Escape to close, focus returns to the trigger (Radix). Title is required. */
export function DialogContent({ title, description, footer, closeLabel = "Fechar", dismissible = true, className, children, onOpenAutoFocus, ...props }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay className={dismissible ? undefined : "backdrop-blur-[3px]"} />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        tabIndex={-1}
        onOpenAutoFocus={
          onOpenAutoFocus ??
          (dismissible
            ? undefined
            : (event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement).focus({ preventScroll: true });
              })
        }
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 animate-sf-pop-in flex-col data-[state=closed]:animate-sf-pop-out rounded-xl bg-surface shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <RadixDialog.Title className="m-0 text-lg font-semibold tracking-[-0.01em] text-fg">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="m-0 mt-0.5 text-xs text-fg-muted">{description}</RadixDialog.Description>
            ) : null}
          </div>
          {dismissible ? (
            <RadixDialog.Close
              aria-label={closeLabel}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </RadixDialog.Close>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
