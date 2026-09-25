import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@salesforce/ui";
import { ChevronDown, LogOut } from "lucide-react";
import type { AuthUser } from "../lib/auth-client";

export interface UserMenuProps {
  user: AuthUser | null;
  onLogout: () => void;
}

/** "Ana Paula Souza" → "Ana Paula" for the top bar (full name stays in the menu). */
function displayName(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).join(" ");
}

/** User menu slot. Without a session (design route) it renders nothing. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu do usuário ${user.name}`}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 text-sidebar-fg-active transition-colors duration-[var(--sf-dur-fast)] hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover md:pr-3"
      >
        <Avatar name={user.name} size="md" className="bg-white text-[var(--sf-navy)]" />
        <span className="hidden max-w-[180px] truncate text-sm font-semibold md:block">{displayName(user.name)}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="text-sidebar-fg" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
