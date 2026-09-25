import { Popover as RadixPopover } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

/** Small floating panel anchored to its trigger (Esc and outside click close it; focus returns to the trigger). */
export function PopoverContent({ className, align = "end", sideOffset = 8, ...props }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn(
          "z-50 w-[340px] max-w-[calc(100vw-2rem)] animate-sf-pop-in data-[state=closed]:animate-sf-pop-out rounded-[14px] bg-surface text-sm text-fg shadow-pop outline-none",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
