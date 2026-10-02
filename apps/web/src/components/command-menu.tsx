import { CommandPalette, type CommandItem } from "@salesforce/ui";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canUseCommercial } from "@salesforce/contracts";
import { navItemsFor } from "./nav-items";

const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

/**
 * Quick navigation (Ctrl K / ⌘ K). Deliberately narrow: it lists only pages the role can open and one action
 * ("Novo pedido"). Customers and products are searched in their own pages, which own the scoped API calls.
 * Visibility follows the navigation; authorization stays on the server.
 */
export function CommandMenu({ role }: { role: string | undefined }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = useMemo<CommandItem[]>(
    () => [
      ...navItemsFor(role).map(({ to, label, icon: Icon }) => ({
        id: `page-${to}`,
        group: "Páginas",
        label,
        icon: <Icon size={18} strokeWidth={1.75} />,
        keywords: to.replace(/\//g, " "),
        onSelect: () => void navigate({ to }),
      })),
      // ROLE-1: the technical profile has no commercial area (the server denies it as well).
      ...(role === undefined || canUseCommercial(role)
        ? [
            {
              id: "action-new-order",
              group: "Ações",
              label: "Novo pedido",
              icon: <Plus size={18} strokeWidth={1.75} />,
              keywords: "criar nova venda rascunho",
              onSelect: () => void navigate({ to: "/pedidos/novo" }),
            },
          ]
        : []),
    ],
    [role, navigate],
  );

  const chip = isApple() ? "⌘ K" : "Ctrl K";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ir para… (${chip})`}
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-sidebar-fg transition-colors duration-[var(--sf-dur-fast)] hover:bg-sidebar-hover hover:text-sidebar-fg-active xl:h-11 xl:w-[220px] xl:justify-start xl:gap-2 xl:rounded-[12px] xl:bg-white/10 xl:px-3 xl:hover:bg-white/15"
      >
        <Search size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="hidden flex-1 text-left text-sm xl:block">Ir para…</span>
        <kbd className="hidden rounded-sm bg-white/15 px-1.5 py-0.5 font-sans text-2xs font-semibold text-sidebar-fg-active xl:block">{chip}</kbd>
      </button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        items={items}
        renderEmpty={() => (
          <>
            Nenhuma página ou ação encontrada.
            <span className="mt-1 block text-xs text-fg-faint">Clientes e produtos são buscados dentro de cada página.</span>
          </>
        )}
      />
    </>
  );
}
