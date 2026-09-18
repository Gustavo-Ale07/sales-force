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
        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-3 data-[state=open]:bg-surface-3"
      >
        <Avatar name={user.name} size="md" />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[160px] truncate text-sm font-medium">{user.name}</span>
          {user.roleLabel ? <span className="block text-2xs text-fg-muted">{user.roleLabel}</span> : null}
        </span>
        <ChevronDown size={13} aria-hidden="true" className="text-fg-muted" />
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
