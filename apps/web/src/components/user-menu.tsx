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
import { LogOut } from "lucide-react";
import type { AuthUser } from "../lib/auth-client";
import { approvalsEnabled, useDiscountAuthorityMode } from "../lib/discount-authority";
import { useGuardedImageSrc } from "../lib/guarded-image";
import { userPhotoSrc } from "../lib/profile-photo";
import { menuItemsFor } from "./nav-items";


export interface UserMenuProps {
  user: AuthUser | null;
  onLogout: () => void;
}

/** User menu slot. Without a session (design route) it renders nothing. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  const navigate = useNavigate();
  const approvals = approvalsEnabled(useDiscountAuthorityMode(user?.role));
  const photoSrc = useGuardedImageSrc(userPhotoSrc(user));
  if (!user) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Menu do usuário ${user.name}`}
        className="flex size-11 items-center justify-center rounded-full transition-shadow duration-[var(--sf-dur-fast)] hover:shadow-[0_0_0_4px_var(--sf-sidebar-hover)] data-[state=open]:shadow-[0_0_0_4px_var(--sf-sidebar-hover)]"
      >
        <Avatar name={user.name} size="lg" className="bg-white font-bold text-[#01136a]" src={photoSrc} />
      </DropdownMenuTrigger>
      <DropdownMenuContent collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {menuItemsFor(user.role, approvals).map(({ to, label, icon: Icon }) => (
          <DropdownMenuItem key={to} onSelect={() => void navigate({ to })}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
