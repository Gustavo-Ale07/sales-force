import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { DialogOverlay } from "./dialog";

export const Drawer = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;
export const DrawerClose = RadixDialog.Close;

const drawerVariants = cva(
  "fixed inset-y-0 z-50 flex w-[min(92vw,var(--drawer-w,420px))] flex-col bg-surface shadow-overlay",
  {
    variants: {
      side: {
        right: "right-0 animate-sf-slide-in-right rounded-l-xl data-[state=closed]:animate-sf-slide-out-right",
        left: "left-0 animate-sf-slide-in-left rounded-r-xl data-[state=closed]:animate-sf-slide-out-left",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export interface DrawerContentProps
  extends Omit<ComponentProps<typeof RadixDialog.Content>, "title">,
    VariantProps<typeof drawerVariants> {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** Visually hide the title bar (e.g. navigation drawer that renders its own header). */
  hideHeader?: boolean;
  closeLabel?: string;
}

/** Side sheet (detail panels, mobile navigation). Same focus management as Dialog. */
export function DrawerContent({
  title,
  description,
  footer,
  side,
  hideHeader,
  closeLabel = "Fechar",
  className,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        className={cn(drawerVariants({ side }), className)}
        {...(description || hideHeader ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        {hideHeader ? (
          <>
            <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{description ?? title}</RadixDialog.Description>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="m-0 text-lg font-semibold tracking-[-0.01em] text-fg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="m-0 mt-0.5 text-xs text-fg-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              aria-label={closeLabel}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </RadixDialog.Close>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
