import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SEC-2 (D7): the web is served by static nginx (deploy/nginx/default.conf), which cannot inject a per-response nonce,
// so react-remove-scroll-bar's inline <style> is allowed with 'unsafe-inline' in style-src ONLY. script-src stays strict.
const conf = readFileSync(resolve(process.cwd(), "../../deploy/nginx/default.conf"), "utf8");
const policies = [...conf.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((m) => m[1] ?? "");
const documentPolicies = policies.filter((p) => p.includes("script-src"));
const directive = (policy: string, name: string) => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("web Content-Security-Policy (nginx)", () => {
  it("covers the SPA shell and the asset locations", () => {
    expect(documentPolicies.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps script-src strict: same origin only, no inline, eval or nonce", () => {
    for (const policy of documentPolicies) expect(directive(policy, "script-src")).toBe("script-src 'self'");
  });

  it("allows 'unsafe-inline' in style-src only", () => {
    for (const policy of documentPolicies) {
      expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
      expect(policy.replace(directive(policy, "style-src"), "")).not.toContain("unsafe-inline");
    }
  });
});
