import { registerBeforeReload, runOtaUpdate, type UpdatesPort } from "./ota-update";

function port(over: Partial<UpdatesPort> = {}, log: string[] = []): UpdatesPort {
  return {
    isEnabled: true,
    checkForUpdateAsync: async () => (log.push("check"), { isAvailable: true }),
    fetchUpdateAsync: async () => (log.push("fetch"), { isNew: true }),
    reloadAsync: async () => void log.push("reload"),
    ...over,
  };
}

describe("runOtaUpdate", () => {
  it("checks, downloads, saves, then reloads, in that order", async () => {
    const log: string[] = [];
    const out = await runOtaUpdate(port({}, log), async () => void log.push("save"));
    expect(out).toBe("reloading");
    expect(log).toEqual(["check", "fetch", "save", "reload"]);
  });

  it("no new update: nothing is downloaded, saved or reloaded", async () => {
    const log: string[] = [];
    const out = await runOtaUpdate(port({ checkForUpdateAsync: async () => (log.push("check"), { isAvailable: false }) }, log), async () => void log.push("save"));
    expect(out).toBe("none");
    expect(log).toEqual(["check"]);
  });

  it("network failure while checking: offline, no reload", async () => {
    const log: string[] = [];
    const out = await runOtaUpdate(port({ checkForUpdateAsync: async () => { throw new Error("Network request failed"); } }, log), async () => void log.push("save"));
    expect(out).toBe("offline");
    expect(log).toEqual([]);
  });

  it("failure while downloading: failed, no reload", async () => {
    const log: string[] = [];
    const out = await runOtaUpdate(port({ fetchUpdateAsync: async () => { throw new Error("bad bundle"); } }, log), async () => void log.push("save"));
    expect(out).toBe("failed");
    expect(log).toEqual(["check"]);
  });

  it("a failing save blocks the reload", async () => {
    const log: string[] = [];
    const out = await runOtaUpdate(port({}, log), async () => { throw new Error("disk"); });
    expect(out).toBe("failed");
    expect(log).not.toContain("reload");
  });

  it("disabled updates: none", async () => {
    expect(await runOtaUpdate(port({ isEnabled: false }))).toBe("none");
  });

  it("registered hooks run before reload by default", async () => {
    const log: string[] = [];
    const off = registerBeforeReload(() => void log.push("save"));
    await runOtaUpdate(port({}, log));
    off();
    expect(log).toEqual(["check", "fetch", "save", "reload"]);
  });
});
