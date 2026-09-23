import {
  Breadcrumbs,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  IconButton,
  Tooltip,
  cn,
  type BreadcrumbItem,
} from "@salesforce/ui";
import { canSeeIntegration } from "@salesforce/contracts";
import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight, Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppServices } from "../lib/app-context";
import type { AuthUser } from "../lib/auth-client";
import { Brand } from "./brand";
import { DevAuthBanner } from "./dev-auth-banner";
import { ConnectedIntegrationPill } from "./integration-pill";
import { navSectionsFor } from "./nav-items";
import { UserMenu } from "./user-menu";

const SIDEBAR_COLLAPSED_KEY = "sf.sidebar.collapsed";

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

const linkBase =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-fg no-underline transition-[background-color,color,box-shadow] duration-150 ease-spring hover:bg-sidebar-hover hover:text-sidebar-fg-active";
// The active rail uses the CTA red (the sidebar's one accent colour): on the dark navy surface it reads as
// "you are here" without borrowing red's action meaning, since nothing here is clickable-as-a-button.
const linkActive = "bg-sidebar-active font-semibold text-sidebar-fg-active shadow-[inset_3px_0_0_var(--sf-sidebar-accent)]";

function SideNav({ role, collapsed, onNavigate }: { role: string | undefined; collapsed?: boolean; onNavigate?: () => void }) {
  const navSections = navSectionsFor(role);
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {navSections.map((section, index) => (
        <div key={section.heading ?? index} className="flex flex-col gap-0.5">
          {section.heading && !collapsed ? (
            <p className="m-0 px-2.5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-sidebar-fg-faint">{section.heading}</p>
          ) : null}
          {section.items.map(({ to, label, icon: Icon }) => {
            const link = (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className={cn(linkBase, collapsed && "justify-center px-0")}
                activeProps={{ className: cn(linkBase, linkActive, collapsed && "justify-center px-0") }}
                onClick={onNavigate}
                aria-label={collapsed ? label : undefined}
              >
                <Icon size={17} aria-hidden="true" className="shrink-0" />
                {collapsed ? null : label}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={to} content={label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Breadcrumbs derived from `staticData.crumb` of the matched routes. */
function RouteBreadcrumbs() {
  const matches = useMatches();
  const items: BreadcrumbItem[] = matches.flatMap((match) => {
    const crumb = match.staticData?.crumb;
    if (!crumb) return [];
    const label = typeof crumb === "function" ? crumb(match.params as Record<string, string>) : crumb;
    return [{ label, href: match.pathname }];
  });
  if (items.length === 0) return null;
  return (
    <Breadcrumbs
      items={items}
      renderLink={(item, className) => (
        // `href` comes from an already-resolved match pathname, so it is a valid concrete route.
        <Link to={item.href as never} className={className}>
          {item.label}
        </Link>
      )}
    />
  );
}

export interface AppShellProps {
  user: AuthUser | null;
  onLogout?: () => void;
  children: ReactNode;
}

/** Application frame: skip link, sidebar (drawer on narrow screens), top bar, page container. */
export function AppShell({ user, onLogout, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const { config } = useAppServices();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const matches = useMatches();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // best-effort only
      }
      return next;
    });
  }

  const lastCrumb = [...matches].reverse().find((m) => m.staticData?.crumb);
  const crumb = lastCrumb?.staticData?.crumb;
  const pageTitle = crumb ? (typeof crumb === "function" ? crumb(lastCrumb.params as Record<string, string>) : crumb) : null;

  // WCAG 2.4.2: distinct page titles.
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} — ${config.installationName}` : config.installationName;
  }, [pageTitle, config.installationName]);

  // WCAG 2.4.3: after an in-app navigation move focus to the page content.
  useEffect(() => {
    // Compare with the previous path (not "first render") so React StrictMode's double effect run cannot steal focus on load.
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        Ir para o conteúdo
      </a>
      <DevAuthBanner />
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto bg-sidebar px-2 py-2.5 shadow-[1px_0_0_var(--sf-sidebar-line)] transition-[width] duration-150 ease-spring md:flex",
            collapsed ? "w-[var(--sf-sidebar-w-collapsed)]" : "w-[var(--sf-sidebar-w)]",
          )}
        >
          <Brand tone="dark" size={collapsed ? "md" : "lg"} collapsed={collapsed} className="px-1.5 pb-3 pt-1" />
          <SideNav role={user?.role} collapsed={collapsed} />
          <div className="mt-auto flex flex-col gap-0.5 border-t border-sidebar-line pt-1.5">
            <Tooltip content={collapsed ? "Expandir menu" : "Recolher menu"} side="right">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-pressed={collapsed}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-fg-faint no-underline transition-colors duration-150 ease-spring hover:bg-sidebar-hover hover:text-sidebar-fg-active",
                  collapsed && "justify-center px-0",
                )}
              >
                {collapsed ? (
                  <ChevronsRight size={17} aria-hidden="true" className="shrink-0" />
                ) : (
                  <ChevronsLeft size={17} aria-hidden="true" className="shrink-0" />
                )}
                {collapsed ? <span className="sr-only">Expandir menu</span> : "Recolher menu"}
              </button>
            </Tooltip>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[var(--sf-topbar-h)] items-center gap-3 border-b border-line/70 bg-surface/95 px-3 backdrop-blur-sm md:px-6">
            <Drawer open={navOpen} onOpenChange={setNavOpen}>
              <DrawerTrigger asChild>
                <IconButton label="Abrir menu de navegação" icon={<Menu size={17} aria-hidden="true" />} className="md:hidden" />
              </DrawerTrigger>
              <DrawerContent
                side="left"
                hideHeader
                title="Menu de navegação"
                className="border-sidebar-line bg-sidebar [--drawer-w:260px] px-2 py-2.5"
              >
                <Brand tone="dark" size="lg" className="px-1.5 pb-3 pt-1" />
                <SideNav role={user?.role} onNavigate={() => setNavOpen(false)} />
              </DrawerContent>
            </Drawer>
            <div className="min-w-0 flex-1">
              <RouteBreadcrumbs />
            </div>
            <div className="flex items-center gap-3">
              {user && canSeeIntegration(user.role) ? <ConnectedIntegrationPill /> : null}
              <div className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />
              <UserMenu user={user} onLogout={onLogout ?? (() => undefined)} />
            </div>
          </header>

          <main
            id="conteudo"
            ref={mainRef}
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-3 py-4 outline-none md:px-6 md:py-5"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
