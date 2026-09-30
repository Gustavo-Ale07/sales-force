import type { Account } from "../auth/auth-port";

const ROLE_LABEL: Record<Account["role"], string> = { admin: "Administrador", manager: "Gerente", seller: "Vendedor" };

export function roleLabel(account: Account): string {
  return ROLE_LABEL[account.role];
}

/** Up to two initials for the avatar fallback. */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
