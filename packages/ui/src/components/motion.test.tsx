import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadingPanel } from "./loading-panel";
import { Reveal } from "./reveal";
import { TopProgress } from "./top-progress";

describe("TopProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits before showing, so a fast response does not flash the bar", () => {
    render(<TopProgress active delayMs={150} />);
    const bar = screen.getByTestId("top-progress");
    expect(bar).not.toHaveAttribute("data-active");
    act(() => vi.advanceTimersByTime(160));
    expect(bar).toHaveAttribute("data-active", "true");
  });

  it("never shows when the work ends before the delay, and hides when it ends", () => {
    const { rerender } = render(<TopProgress active delayMs={150} />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<TopProgress active={false} delayMs={150} />);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId("top-progress")).not.toHaveAttribute("data-active");

    rerender(<TopProgress active delayMs={150} />);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("top-progress")).toHaveAttribute("data-active", "true");
    rerender(<TopProgress active={false} delayMs={150} />);
    expect(screen.getByTestId("top-progress")).not.toHaveAttribute("data-active");
  });

  it("is decorative for assistive technology", () => {
    render(<TopProgress active />);
    expect(screen.getByTestId("top-progress")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Reveal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the content at once when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Reveal>conteúdo</Reveal>);
    expect(screen.getByText("conteúdo")).toHaveAttribute("data-revealed", "true");
  });

  it("stays hidden until it scrolls into view, then reveals once", () => {
    let callback: IntersectionObserverCallback = () => undefined;
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<Reveal delayMs={80}>abaixo</Reveal>);
    const node = screen.getByText("abaixo");
    expect(node).toHaveAttribute("data-revealed", "false");
    expect(node.style.transitionDelay).toBe("80ms");
    act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(node).toHaveAttribute("data-revealed", "false");
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(node).toHaveAttribute("data-revealed", "true");
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("LoadingPanel", () => {
  it("announces what is loading once", () => {
    render(<LoadingPanel title="Consultando o ERP…" description="Aguarde" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Consultando o ERP…")).toBeInTheDocument();
  });
});

describe("interaction and motion styles", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");

  it("shows the pointer on everything clickable and not-allowed on what is disabled", () => {
    for (const selector of ['[role="tab"]', '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]', "summary", "select", "a[href]"]) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/cursor: pointer;/);
    expect(css).toMatch(/cursor: not-allowed;/);
  });

  it("has an exit animation for every overlay entrance and honours reduced motion", () => {
    for (const name of ["sf-fade-out", "sf-pop-out", "sf-slide-out-right", "sf-slide-out-left", "sf-toast-out"]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
