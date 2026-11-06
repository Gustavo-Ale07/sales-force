import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";
import { syncStatusQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import type { AuthUser } from "../lib/auth-client";
import { clockTime } from "../lib/sync-refresh";
import { RefreshDataDialog } from "./refresh-data-dialog";

export interface UserMenuProps {
  user: AuthUser | null;
  onLogout: () => void;
}

/** User menu slot. Without a session (design route) it renders nothing. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  const navigate = useNavigate();
  const api = useApi();
  const [refreshOpen, setRefreshOpen] = useState(false);
  const status = useQuery({ ...syncStatusQueryOptions(api), enabled: user !== null });
  if (!user) return null;
  const dataAsOf = status.data?.dataAsOf ?? null;
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu do usuário ${user.name}`}
        className="flex size-11 items-center justify-center rounded-full transition-shadow duration-[var(--sf-dur-fast)] hover:shadow-[0_0_0_4px_var(--sf-sidebar-hover)] data-[state=open]:shadow-[0_0_0_4px_var(--sf-sidebar-hover)]"
      >
        <Avatar name={user.name} size="lg" className="bg-white text-[var(--sf-navy)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: "/perfil" })}>
          <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
          Meu perfil
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRefreshOpen(true)}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          Atualizar dados
        </DropdownMenuItem>
        {dataAsOf ? <DropdownMenuLabel className="pt-0 text-xs font-normal">Dados do Sankhya de {clockTime(dataAsOf)}</DropdownMenuLabel> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <RefreshDataDialog open={refreshOpen} onClose={() => setRefreshOpen(false)} />
    </>
  );
}
