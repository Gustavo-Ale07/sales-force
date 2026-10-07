import { cn } from "@salesforce/ui";
import { useState } from "react";
import { useAppServices } from "../lib/app-context";

/** True until the image at `src` fails to load (file not mounted, wrong format): the caller then falls back. */
function useImageOk(src: string | null): { ok: boolean; onError: () => void } {
  const [failed, setFailed] = useState<string | null>(null);
  return { ok: src !== null && failed !== src, onError: () => setFailed(src) };
}

/**
 * The installation's identity, one component for the shell and the login page. Precedence: the configured
 * logo (which already carries the name), else the configured mark plus the name, else the neutral "SF"
 * placeholder plus the name. Asset paths were validated when the runtime configuration was parsed; an image
 * that fails to load falls through to the next option instead of leaving a broken-image icon.
 *
 * `tone="dark"` is for the navy sidebar: the installation logo is expected to be legible on light surfaces
 * (login), and it is drawn bare on both tones as in the reference kit, where the wordmark sits directly on
 * the navy bar; on dark the fallback mark switches to the CTA red (the one place red stands in for the institutional mark, per the brand
 * direction — everywhere else red stays reserved for actions). "Force" is always the product's own
 * name, shown as the secondary line under the installation's identity, never replacing it.
 */
export function Brand({
  size = "md",
  tone = "light",
  collapsed = false,
  showProductName: withProductName = true,
  preferMark = false,
  className,
}: {
  size?: "md" | "lg";
  tone?: "light" | "dark";
  /** Icon/mark only, no name (the collapsed sidebar rail). Ignored unless a mark/logo/initial can stand alone. */
  collapsed?: boolean;
  /** Secondary "Force" line next to the name; the login shows the bare wordmark instead. */
  showProductName?: boolean;
  /** Use the mark + installation name even when a full logo is configured (the in-app header, unlike the login page). */
  preferMark?: boolean;
  className?: string;
}) {
  const { config } = useAppServices();
  const { logoUrl, markUrl } = config.brand;
  const name = config.installationName;
  const logo = useImageOk(logoUrl);
  const mark = useImageOk(markUrl);
  const dark = tone === "dark";
  const showProductName = withProductName && !collapsed && !dark && name !== "Force";

  const logoImg = logoUrl !== null && logo.ok && !preferMark;
  const box = size === "lg" ? "size-9 rounded-lg text-xs" : "size-8 rounded-lg text-xs";
  const secondaryClass = cn("block truncate text-2xs font-medium uppercase tracking-wider", dark ? "text-sidebar-fg-faint" : "text-fg-faint");

  if (logoImg && !collapsed) {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        <span className="inline-flex shrink-0 items-center justify-center">
          <img
            src={logoUrl}
            alt={name}
            onError={logo.onError}
            className={cn(size === "lg" ? "h-9 max-w-[132px]" : "h-8 max-w-[108px]", "w-auto rounded-[6px] object-contain object-left")}
          />
        </span>
        {showProductName ? <span className={secondaryClass}>Force</span> : null}
      </div>
    );
  }

  const markNode =
    markUrl !== null && mark.ok ? (
      <img src={markUrl} alt={collapsed ? name : ""} aria-hidden={!collapsed} onError={mark.onError} className={cn(box, "shrink-0 object-contain")} />
    ) : (
      <span
        aria-hidden={!collapsed}
        role={collapsed ? "img" : undefined}
        aria-label={collapsed ? name : undefined}
        className={cn(
          box,
          "grid shrink-0 place-items-center font-heading font-extrabold tracking-wide",
          dark ? "bg-cta text-on-cta" : "bg-accent text-on-accent",
        )}
      >
        {name.slice(0, 1).toUpperCase() || "S"}
      </span>
    );

  if (collapsed) {
    return <div className={cn("flex items-center justify-center", className)}>{markNode}</div>;
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {markNode}
      <span className="min-w-0 leading-tight">
        <span className={cn("block truncate font-heading font-bold", size === "lg" ? "text-lg" : "text-sm", dark ? "text-sidebar-fg-active" : "text-fg")}>
          {name}
        </span>
        {showProductName ? <span className={secondaryClass}>Force</span> : null}
      </span>
    </div>
  );
}
