import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "../lib/cn";

export interface RevealProps extends ComponentProps<"div"> {
  /** Stagger between siblings, in milliseconds. */
  delayMs?: number;
}

const canObserve = () => typeof IntersectionObserver !== "undefined";

/**
 * Fades and lifts its content the first time it scrolls into view. Without IntersectionObserver (old browsers,
 * tests, print) the content is simply shown: the animation never hides anything for good. The transform is
 * dropped once revealed so sticky/fixed descendants behave normally.
 */
export function Reveal({ delayMs = 0, className, style, children, ...props }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(!canObserve());
  useEffect(() => {
    const node = ref.current;
    if (revealed || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);
  return (
    <div
      ref={ref}
      data-revealed={revealed}
      style={delayMs > 0 ? { ...style, transitionDelay: `${delayMs}ms` } : style}
      className={cn(
        "translate-y-3 opacity-0 transition-[opacity,translate] duration-[var(--sf-dur-slow)] ease-spring data-[revealed=true]:translate-none data-[revealed=true]:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
