import { ChevronRight } from "lucide-react";
import { Fragment, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page. */
  href?: string;
}

export interface BreadcrumbsProps extends Omit<ComponentProps<"nav">, "children"> {
  items: BreadcrumbItem[];
  /** Router integration: render the link for an item (default: plain anchor). */
  renderLink?: (item: BreadcrumbItem, className: string) => ReactNode;
}

const linkClass = "rounded-sm text-fg-muted hover:text-fg hover:underline";

export function Breadcrumbs({ items, renderLink, className, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label="Trilha de navegação" className={cn("min-w-0 text-xs", className)} {...props}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="min-w-0 truncate">
                {item.href && !last ? (
                  renderLink ? (
                    renderLink(item, linkClass)
                  ) : (
                    <a href={item.href} className={linkClass}>
                      {item.label}
                    </a>
                  )
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-fg" : "text-fg-muted"}>
                    {item.label}
                  </span>
                )}
              </li>
              {last ? null : (
                <li aria-hidden="true" className="flex text-fg-faint">
                  <ChevronRight size={12} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps extends Omit<ComponentProps<"header">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Status badges next to the title. */
  badges?: ReactNode;
  /** Primary/secondary actions, right-aligned. */
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}

export function PageHeader({ title, description, badges, actions, breadcrumbs, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-1", className)} {...props}>
      {breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-fg">
            {title}
            {badges}
          </h1>
          {description ? <p className="m-0 mt-0.5 text-xs text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
    </header>
  );
}
