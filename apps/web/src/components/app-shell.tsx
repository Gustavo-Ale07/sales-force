import {
  Breadcrumbs,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  IconButton,
  cn,
  type BreadcrumbItem,
} from "@salesforce/ui";
import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppServices } from "../lib/app-context";
import type { AuthUser } from "../lib/auth-client";
import { DevAuthBanner } from "./dev-auth-banner";
import { IntegrationPill, type IntegrationState } from "./integration-pill";
import { navSections } from "./nav-items";
import { UserMenu } from "./user-menu";

const linkBase =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted no-underline hover:bg-surface-3 hover:text-fg";
const linkActive = "bg-accent-weak font-semibold text-fg shadow-[inset_2px_0_0_var(--sf-accent)]";

function Brand() {
  const { config } = useAppServices();
  return (
    <div className="flex items-center gap-2 px-2 pb-3 pt-1">
      <span
        aria-hidden="true"
        className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-[10px] font-extrabold tracking-wide text-on-accent"
      >
        SF
      </span>
      <span className="truncate text-sm font-bold">{config.installationName}</span>
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {navSections.map((section, index) => (
        <div key={section.heading ?? index} className="flex flex-col gap-0.5">
          {section.heading ? (
            <p className="m-0 px-2 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-fg-faint">{section.heading}</p>
          ) : null}
          {section.items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className={linkBase}
              activeProps={{ className: cn(linkBase, linkActive) }}
              onClick={onNavigate}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </Link>
          ))}
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
  integrationState?: IntegrationState;
  children: ReactNode;
}

/** Application frame: skip link, sidebar (drawer on narrow screens), top bar, page container. */
export function AppShell({ user, onLogout, integrationState, children }: AppShellProps) {
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
      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-0 hidden h-screen w-[var(--sf-sidebar-w)] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-2 py-2.5 md:flex">
          <Brand />
          <SideNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[var(--sf-topbar-h)] items-center gap-3 border-b border-line bg-surface px-3 md:px-6">
            <Drawer open={navOpen} onOpenChange={setNavOpen}>
              <DrawerTrigger asChild>
                <IconButton label="Abrir menu de navegação" icon={<Menu size={17} aria-hidden="true" />} className="md:hidden" />
              </DrawerTrigger>
              <DrawerContent side="left" hideHeader title="Menu de navegação" className="[--drawer-w:260px] px-2 py-2.5">
                <Brand />
                <SideNav onNavigate={() => setNavOpen(false)} />
              </DrawerContent>
            </Drawer>
            <div className="min-w-0 flex-1">
              <RouteBreadcrumbs />
            </div>
            <div className="flex items-center gap-3">
              <IntegrationPill state={integrationState} />
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
