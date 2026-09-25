import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

export interface TopProgressProps {
  /** Something is loading. */
  active: boolean;
  /** Wait this long before showing, so instant responses do not flash a bar. */
  delayMs?: number;
  className?: string;
}

/**
 * Thin indeterminate bar pinned to the top of the window while data loads. Decorative (hidden from assistive
 * technology): the places that load announce their own state. It fades in after `delayMs` and out when done.
 */
export function TopProgress({ active, delayMs = 150, className }: TopProgressProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active, delayMs]);
  return (
    <div
      aria-hidden="true"
      data-testid="top-progress"
      data-active={shown || undefined}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden opacity-0 transition-opacity duration-[var(--sf-dur-slow)] data-[active=true]:opacity-100",
        className,
      )}
    >
      <div className="h-full w-2/5 animate-sf-progress rounded-r-full bg-cta shadow-[0_0_8px_var(--sf-cta)]" />
    </div>
  );
}
