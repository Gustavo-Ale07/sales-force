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
 */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const { config } = useAppServices();
  const { logoUrl, markUrl } = config.brand;
  const name = config.installationName;
  const logo = useImageOk(logoUrl);
  const mark = useImageOk(markUrl);

  if (logoUrl !== null && logo.ok) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={logo.onError}
        className={cn(size === "lg" ? "h-10 max-w-[220px]" : "h-7 max-w-[168px]", "w-auto object-contain object-left", className)}
      />
    );
  }

  const box = size === "lg" ? "size-9 rounded-lg text-xs" : "size-7 rounded-md text-2xs";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {markUrl !== null && mark.ok ? (
        <img src={markUrl} alt="" aria-hidden="true" onError={mark.onError} className={cn(box, "shrink-0 object-contain")} />
      ) : (
        <span aria-hidden="true" className={cn(box, "grid shrink-0 place-items-center bg-accent font-extrabold tracking-wide text-on-accent")}>
          SF
        </span>
      )}
      <span className={cn("truncate font-bold", size === "lg" ? "text-lg" : "text-sm")}>{name}</span>
    </div>
  );
}
