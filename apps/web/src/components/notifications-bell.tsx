import { Popover, PopoverContent, PopoverTrigger } from "@salesforce/ui";
import { Bell } from "lucide-react";

/**
 * Notifications slot of the top bar (reference kit: bell with a popover). There is no notification source in the
 * product yet, so it is visual infrastructure only: it always shows the empty state and never a badge or counter.
 * When a real source exists, feed the list here and add the unread marker at the same time.
 */
export function NotificationsBell() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notificações"
        className="flex size-11 items-center justify-center rounded-full text-sidebar-fg transition-colors duration-[var(--sf-dur-fast)] hover:bg-sidebar-hover hover:text-sidebar-fg-active data-[state=open]:bg-sidebar-hover data-[state=open]:text-sidebar-fg-active"
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent aria-label="Notificações">
        <div className="border-b border-line px-4 py-3 font-semibold">Notificações</div>
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-fg-muted">
            <Bell size={18} strokeWidth={1.75} />
          </span>
          <p className="m-0 text-sm text-fg-muted">Você não possui novas notificações.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
