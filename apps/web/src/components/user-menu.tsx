import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@salesforce/ui";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import type { AuthUser } from "../lib/auth-client";
import { isOperationsRole } from "../lib/operations-role";
import { userPhotoSrc } from "../lib/profile-photo";


export interface UserMenuProps {
  user: AuthUser | null;
  onLogout: () => void;
}

/** User menu slot. Without a session (design route) it renders nothing. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Menu do usuário ${user.name}`}
        className="flex size-11 items-center justify-center rounded-full transition-shadow duration-[var(--sf-dur-fast)] hover:shadow-[0_0_0_4px_var(--sf-sidebar-hover)] data-[state=open]:shadow-[0_0_0_4px_var(--sf-sidebar-hover)]"
      >
        <Avatar name={user.name} size="lg" className="bg-white text-[var(--sf-navy)]" src={userPhotoSrc(user)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isOperationsRole(user.role) ? null : (
          <DropdownMenuItem onSelect={() => void navigate({ to: "/perfil" })}>
            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
            Perfil
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
