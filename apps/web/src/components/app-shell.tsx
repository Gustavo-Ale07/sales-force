import { Breadcrumbs, Drawer, DrawerContent, DrawerTrigger, IconButton, type BreadcrumbItem } from "@salesforce/ui";
import { canSeeIntegration } from "@salesforce/contracts";
import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppServices } from "../lib/app-context";
import type { AuthUser } from "../lib/auth-client";
import { Brand } from "./brand";
import { DevAuthBanner } from "./dev-auth-banner";
import { ConnectedIntegrationPill } from "./integration-pill";
import { navItemsFor } from "./nav-items";
import { UserMenu } from "./user-menu";

// Horizontal navigation, as in Vidya Force: white text on the navy bar; the active item is a white pill with
// navy bold text. Structure is replicated from the legacy system, the skin (PLAC navy/red, own logo) is ours.
// The router sets `data-status="active"` on the current link; styling off that attribute (instead of swapping
// class strings) keeps the active colours from losing a Tailwind specificity/merge fight with the base ones.
const topLink =
  "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-fg-active no-underline transition-[background-color,color] duration-150 ease-spring hover:bg-sidebar-hover data-[status=active]:bg-white data-[status=active]:font-bold data-[status=active]:text-[var(--sf-sidebar-bg)]";

function TopNav({ role }: { role: string | undefined }) {
  return (
    <nav aria-label="Principal" className="hidden items-center gap-1.5 md:flex">
      {navItemsFor(role).map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className={topLink}>
          <Icon size={16} aria-hidden="true" className="shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

const drawerLink =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm font-medium uppercase tracking-wide text-sidebar-fg no-underline transition-colors duration-150 ease-spring hover:bg-sidebar-hover hover:text-sidebar-fg-active data-[status=active]:bg-white data-[status=active]:font-bold data-[status=active]:text-[var(--sf-sidebar-bg)]";

/** Same items as `TopNav`, stacked, for the drawer used below the `md` breakpoint. */
function DrawerNav({ role, onNavigate }: { role: string | undefined; onNavigate: () => void }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {navItemsFor(role).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          className={drawerLink}
          onClick={onNavigate}
        >
          <Icon size={17} aria-hidden="true" className="shrink-0" />
          {label}
        </Link>
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

/** Application frame: skip link, horizontal navbar (drawer on narrow screens), breadcrumbs, page container. */
export function AppShell({ user, onLogout, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const { config } = useAppServices();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const matches = useMatches();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

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
      <header className="sticky top-0 z-30 flex h-[var(--sf-topbar-h)] shrink-0 items-center gap-3 bg-[linear-gradient(90deg,var(--sf-sidebar-bg),var(--sf-sidebar-bg-raised))] px-3 shadow-[0_1px_0_var(--sf-sidebar-line)] md:px-6">
        <Drawer open={navOpen} onOpenChange={setNavOpen}>
          <DrawerTrigger asChild>
            <IconButton
              label="Abrir menu de navegação"
              icon={<Menu size={17} aria-hidden="true" />}
              className="text-sidebar-fg-active hover:bg-sidebar-hover md:hidden"
            />
          </DrawerTrigger>
          <DrawerContent
            side="left"
            hideHeader
            title="Menu de navegação"
            className="border-sidebar-line bg-sidebar [--drawer-w:260px] px-2 py-2.5"
          >
            <Brand tone="dark" size="lg" className="px-1.5 pb-3 pt-1" />
            <DrawerNav role={user?.role} onNavigate={() => setNavOpen(false)} />
          </DrawerContent>
        </Drawer>
        <Brand tone="dark" size="md" className="shrink-0" />
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <TopNav role={user?.role} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {user && canSeeIntegration(user.role) ? <ConnectedIntegrationPill /> : null}
          <UserMenu user={user} onLogout={onLogout ?? (() => undefined)} />
        </div>
      </header>

      <main
        id="conteudo"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-3 py-4 outline-none md:px-6 md:py-5"
      >
        <RouteBreadcrumbs />
        {children}
      </main>
    </div>
  );
}
