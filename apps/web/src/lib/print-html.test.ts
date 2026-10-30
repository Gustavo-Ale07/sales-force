import { describe, expect, it, vi } from "vitest";
import { printHtml } from "./print-html";

describe("printHtml", () => {
  it("builds a hidden sandboxed iframe with the document and prints when it loads", () => {
    printHtml("<p>oi</p>");
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.srcdoc).toBe("<p>oi</p>");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    const print = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: Object.assign(new EventTarget(), { print, focus: vi.fn(), addEventListener: vi.fn() }) });
    frame.dispatchEvent(new Event("load"));
    expect(print).toHaveBeenCalledTimes(1);
    frame.remove();
  });
});
