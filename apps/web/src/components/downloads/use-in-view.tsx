import { cn } from "@salesforce/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

const hasObserver = () => typeof IntersectionObserver !== "undefined";

/**
 * True while the element is (or, with `once`, has been) in the viewport. Without IntersectionObserver
 * (jsdom, very old browsers) it is `true`, so content is never left hidden.
 */
export function useInView<T extends Element>(options: { once?: boolean; threshold?: number } = {}) {
  const { once = false, threshold = 0.15 } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => !hasObserver());
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasObserver()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [once, threshold]);
  return [ref, inView] as const;
}

/** Fades and lifts its children in once, the first time they scroll into view (CSS turns it off for reduced motion). */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, threshold: 0.12 });
  return (
    <div ref={ref} data-in={inView} className={cn("dl-reveal", className)} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
