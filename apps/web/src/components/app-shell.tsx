import { cn, Drawer, DrawerContent, DrawerTrigger, IconButton, Tooltip, type BreadcrumbItem } from "@salesforce/ui";
import { canSeeIntegration } from "@salesforce/contracts";
import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppServices } from "../lib/app-context";
import { documentTitleBase } from "../lib/brand";
import { approvalsEnabled, useDiscountAuthorityMode } from "../lib/discount-authority";
import type { AuthUser } from "../lib/auth-client";
import { useRealtimeSync } from "../lib/realtime";
import { useReleaseQueueAccess } from "../lib/release-queue";
import { Brand } from "./brand";
import { CommandMenu } from "./command-menu";
import { DevAuthBanner } from "./dev-auth-banner";
import { GlobalActivity } from "./global-activity";
import { ConnectedIntegrationPill } from "./integration-pill";
import { navItemsFor } from "./nav-items";
import { SyncIndicator } from "./sync-indicator";
import { UserMenu } from "./user-menu";

// Horizontal navigation (structure from Vidya Force, skin from the PLAC reference kit): sentence-case white
// labels on the flat navy bar; the active item is a white pill with navy text; a 3px red line closes the bar.
// The router sets `data-status="active"` on the current link; styling off that attribute (instead of swapping
// class strings) keeps the active colours from losing a Tailwind specificity/merge fight with the base ones.
const topLink =
  "flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[12px] px-3 text-[15px] font-semibold text-sidebar-fg no-underline transition-[background-color,color] duration-[var(--sf-dur-fast)] ease-spring hover:bg-sidebar-hover hover:text-sidebar-fg-active data-[status=active]:bg-white data-[status=active]:text-[var(--sf-sidebar-bg)] data-[status=active]:shadow-[0_2px_8px_rgba(0,0,0,0.18)]";

/** Counter on the "Aguardando liberação" item; the number is also spoken ("N pedidos aguardando"). */
function QueueBadge({ total }: { total: number }) {
  if (total <= 0) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--sf-red)] px-1.5 text-xs font-bold leading-5 text-white">
        {total > 99 ? "99+" : total}
      </span>
      <span className="sr-only">{`, ${total} ${total === 1 ? "pedido aguardando" : "pedidos aguardando"}`}</span>
    </>
  );
}

/**
 * Width (of the bar area left for the links) from which the labels fit, by number of items. Below it the links are
 * icon-only with a tooltip, so nothing ever wraps or overlaps at any window width. Literal strings so Tailwind sees them.
 */
function labelClasses(count: number): { label: string; icon: string } {
  if (count <= 3) return { label: "@min-[320px]:not-sr-only", icon: "@min-[320px]:hidden" };
  if (count <= 6) return { label: "@min-[700px]:not-sr-only", icon: "@min-[700px]:hidden" };
  if (count === 7) return { label: "@min-[860px]:not-sr-only", icon: "@min-[860px]:hidden" };
  if (count === 8) return { label: "@min-[980px]:not-sr-only", icon: "@min-[980px]:hidden" };
  return { label: "@min-[1120px]:not-sr-only", icon: "@min-[1120px]:hidden" };
}

function TopNav({ role }: { role: string | undefined }) {
  const approvals = approvalsEnabled(useDiscountAuthorityMode(role));
  const queue = useReleaseQueueAccess(role);
  const items = navItemsFor(role, approvals, queue.visible);
  const classes = labelClasses(items.length);
  return (
    <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
      {items.map(({ to, label, icon: Icon }) => (
        <Tooltip key={to} content={label} side="bottom">
          <Link to={to} activeOptions={{ exact: to === "/" }} className={topLink}>
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={cn("shrink-0", classes.icon)} />
            <span className={cn("sr-only", classes.label)}>{label}</span>
            {to === "/aguardando-liberacao" ? <QueueBadge total={queue.total} /> : null}
          </Link>
        </Tooltip>
      ))}
    </nav>
  );
}

const drawerLink =
  "flex items-center gap-3 rounded-md px-3 py-3 text-base font-semibold text-sidebar-fg no-underline transition-colors duration-[var(--sf-dur-fast)] ease-spring hover:bg-sidebar-hover hover:text-sidebar-fg-active data-[status=active]:bg-white data-[status=active]:text-[var(--sf-sidebar-bg)]";

/** Same items as `TopNav`, stacked, for the drawer used below the `lg` breakpoint. */
function DrawerNav({ role, onNavigate }: { role: string | undefined; onNavigate: () => void }) {
  const approvals = approvalsEnabled(useDiscountAuthorityMode(role));
  const queue = useReleaseQueueAccess(role);
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {navItemsFor(role, approvals, queue.visible).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          className={drawerLink}
          onClick={onNavigate}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {label}
          {to === "/aguardando-liberacao" ? <QueueBadge total={queue.total} /> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Back link ("← Clientes") to the parent of the current page, derived from `staticData.crumb` of the matched routes. */
function RouteBreadcrumbs() {
  const matches = useMatches();
  const items: BreadcrumbItem[] = matches.flatMap((match) => {
    const crumb = match.staticData?.crumb;
    if (!crumb) return [];
    const label = typeof crumb === "function" ? crumb(match.params as Record<string, string>) : crumb;
    return [{ label, href: match.pathname }];
  });
  // Top-level pages have no parent to go back to.
  const parent = items.length >= 2 ? items[items.length - 2] : undefined;
  if (!parent) return null;
  return (
    <nav aria-label="Trilha de navegação" className="-mb-2">
      {/* `href` comes from an already-resolved match pathname, so it is a valid concrete route. */}
      <Link
        to={parent.href as never}
        className="group inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted no-underline transition-colors duration-[var(--sf-dur-fast)] hover:text-fg"
      >
        <ArrowLeft
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className="transition-transform duration-[var(--sf-dur-fast)] ease-spring group-hover:-translate-x-0.5"
        />
        {parent.label}
      </Link>
    </nav>
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

  // RT-1: one event stream for the whole signed-in session.
  useRealtimeSync(Boolean(user));

  const lastCrumb = [...matches].reverse().find((m) => m.staticData?.crumb);
  const crumb = lastCrumb?.staticData?.crumb;
  const pageTitle = crumb ? (typeof crumb === "function" ? crumb(lastCrumb.params as Record<string, string>) : crumb) : null;

  // WCAG 2.4.2: distinct page titles.
  useEffect(() => {
    const base = documentTitleBase(config.installationName);
    document.title = pageTitle ? `${pageTitle} — ${base}` : base;
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
      <GlobalActivity />
      <DevAuthBanner />
      <header className="sticky top-0 z-30 flex h-[var(--sf-topbar-h)] shrink-0 items-center gap-3 border-b-[length:var(--sf-topbar-line-h)] border-b-[var(--sf-red)] bg-sidebar px-3 md:gap-6 md:px-8">
        <Drawer open={navOpen} onOpenChange={setNavOpen}>
          <DrawerTrigger asChild>
            <IconButton
              label="Abrir menu de navegação"
              icon={<Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
              className="text-sidebar-fg-active hover:bg-sidebar-hover lg:hidden"
            />
          </DrawerTrigger>
          <DrawerContent
            side="left"
            hideHeader
            title="Menu de navegação"
            className="bg-sidebar [--drawer-w:280px] px-3 py-4"
          >
            <Brand tone="dark" size="lg" preferMark className="px-1.5 pb-3 pt-1" />
            <DrawerNav role={user?.role} onNavigate={() => setNavOpen(false)} />
          </DrawerContent>
        </Drawer>
        <Brand tone="dark" size="md" preferMark className="shrink-0" />
        <div className="@container flex min-w-0 flex-1 items-center lg:pl-4">
          <TopNav role={user?.role} />
        </div>
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          {user && canSeeIntegration(user.role) ? <ConnectedIntegrationPill /> : null}
          {user ? <SyncIndicator role={user.role} /> : null}
          <CommandMenu role={user?.role} />
          <UserMenu user={user} onLogout={onLogout ?? (() => undefined)} />
        </div>
      </header>

      <main
        id="conteudo"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-6 outline-none md:px-8 md:py-8 xl:px-12"
      >
        <RouteBreadcrumbs />
        {/* Keyed by page so each navigation fades in (opacity only, so fixed/sticky descendants are unaffected). */}
        <div key={pathname} className="flex min-w-0 flex-1 animate-sf-fade-in flex-col gap-6">
          {children}
        </div>
      </main>
    </div>
  );
}
