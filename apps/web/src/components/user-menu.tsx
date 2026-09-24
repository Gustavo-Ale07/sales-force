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

/** User menu slot. Without a session (design route) it renders nothing. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu do usuário ${user.name}`}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sidebar-fg-active hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover"
      >
        <span className="hidden max-w-[200px] truncate text-sm md:block">Olá, {user.name}</span>
        <Avatar name={user.name} size="md" />
        <ChevronDown size={13} aria-hidden="true" className="text-sidebar-fg" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut size={14} aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
