import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CSP (deploy/nginx/default.conf) blocks the inline <style> react-remove-scroll-bar injects, so
// scroll lock is done via our own stylesheet against body[data-scroll-locked] instead. The actual
// scrolling element in this app is <html> (no html/body height+overflow reset), confirmed live with
// document.scrollingElement — so overflow:hidden on body alone never stops the page scrolling; the
// html:has(...) rule is what actually blocks it. Regression-guards the CSS text itself: jsdom has no
// layout engine, so it cannot exercise real wheel-driven scroll like a browser would.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("overlay scroll lock (index.css)", () => {
  it("hides overflow on body when Radix locks scroll", () => {
    expect(css).toMatch(/body\[data-scroll-locked\]\s*{[^}]*overflow:\s*hidden/);
  });

  it("also hides overflow on html, the actual scrolling element, or the body rule above is inert", () => {
    expect(css).toMatch(/html:has\(body\[data-scroll-locked\]\)\s*{[^}]*overflow:\s*hidden/);
  });
});
