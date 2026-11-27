import "@testing-library/jest-dom/vitest";
import { clearToasts } from "@salesforce/ui";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { clearGuardedImageCache } from "./lib/guarded-image";
import { TEST_SERVER_CODE } from "./test/server-code";

// jsdom does not implement scrolling; the router calls it on navigation.
vi.stubGlobal("scrollTo", vi.fn());

// Every test starts in a browser that already has a server code (the gate tests clear it). Seeded before any spy a test installs.
beforeEach(() => {
  window.localStorage.setItem("sf.serverCode", TEST_SERVER_CODE);
});

afterEach(() => {
  window.localStorage.clear();
  clearGuardedImageCache();
  cleanup();
  clearToasts();
  // Radix modal layers set these on <body> and a test can end while one is open.
  document.body.style.pointerEvents = "";
  document.body.removeAttribute("data-scroll-locked");
});

// jsdom lacks these browser APIs used by Radix primitives.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
