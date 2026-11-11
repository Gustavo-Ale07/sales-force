import type { LatestRelease } from "./apk-update";
import { updateResultMessage, updateStepMessage } from "./update-messages";

const release: LatestRelease = { channel: "staging", versionName: "0.2.0", versionCode: 12, minVersionCode: 10, file: "a.apk", sha256: "0".repeat(64), sizeBytes: 1 };

describe("update messages", () => {
  it("covers every outcome without leaking technical detail", () => {
    expect(updateResultMessage({ kind: "up-to-date" })).toMatch(/mais recente/);
    expect(updateResultMessage({ kind: "installer-opened", release })).toMatch(/0\.2\.0/);
    expect(updateResultMessage({ kind: "unavailable", reason: "network" })).toMatch(/Sem conexão/);
    expect(updateResultMessage({ kind: "unavailable", reason: "invalid-manifest" })).toMatch(/indisponível/);
    expect(updateResultMessage({ kind: "failed", reason: "digest-mismatch", release })).toMatch(/descartado/);
    expect(updateResultMessage({ kind: "failed", reason: "size-mismatch", release })).toMatch(/descartado/);
    expect(updateResultMessage({ kind: "failed", reason: "download", release })).toMatch(/baixar/);
    expect(updateResultMessage({ kind: "failed", reason: "install", release })).toMatch(/instalador/);
  });

  it("shows download progress as a bounded percentage", () => {
    expect(updateStepMessage("downloading", { written: 50, total: 200 })).toBe("Baixando… 25%");
    expect(updateStepMessage("downloading", { written: 300, total: 200 })).toBe("Baixando… 100%");
    expect(updateStepMessage("downloading")).toBe("Baixando…");
  });
});
