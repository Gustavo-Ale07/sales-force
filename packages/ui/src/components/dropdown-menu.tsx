import { DropdownMenu as RadixMenu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuGroup = RadixMenu.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...props }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-[200px] animate-sf-pop-in overflow-hidden rounded-lg bg-surface p-1.5 text-sm shadow-pop",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof RadixMenu.Item> {
  destructive?: boolean;
}

export function DropdownMenuItem({ className, destructive, ...props }: DropdownMenuItemProps) {
  return (
    <RadixMenu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:text-fg-faint data-[highlighted]:bg-accent-weak",
        destructive ? "text-danger" : "text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof RadixMenu.Label>) {
  return <RadixMenu.Label className={cn("px-3 py-1.5 text-xs text-fg-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
