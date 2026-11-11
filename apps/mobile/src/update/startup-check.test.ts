import type { UpdateIo } from "./apk-update";
import { runStartupCheck } from "./startup-check";

const manifest = { channel: "staging", versionName: "0.3.0", versionCode: 12, minVersionCode: 10, file: "f.apk", sha256: "a".repeat(64), sizeBytes: 5 };

function io(fetchJson: UpdateIo["fetchJson"]): UpdateIo {
  return { fetchJson, download: jest.fn(), fileSize: jest.fn(), readChunks: jest.fn(), remove: jest.fn(), openInstaller: jest.fn() };
}
const base = { apiOrigin: "https://force.example.com", channel: "staging" as string | undefined };

describe("runStartupCheck", () => {
  it("requires the update when the installed build is below the minimum, without downloading", async () => {
    const device = io(async () => manifest);
    const result = await runStartupCheck({ ...base, io: device, installedVersionCode: 9 });
    expect(result).toMatchObject({ kind: "required", release: { versionCode: 12 } });
    expect(device.download).not.toHaveBeenCalled();
  });

  it("opens the app when the build is current or only an optional update exists", async () => {
    expect((await runStartupCheck({ ...base, io: io(async () => manifest), installedVersionCode: 12 })).kind).toBe("open");
    expect((await runStartupCheck({ ...base, io: io(async () => manifest), installedVersionCode: 10 })).kind).toBe("open");
  });

  it("keeps the app usable offline or with a broken manifest", async () => {
    expect((await runStartupCheck({ ...base, io: io(async () => { throw new Error("offline"); }), installedVersionCode: 1 })).kind).toBe("open");
    expect((await runStartupCheck({ ...base, io: io(async () => ({ junk: 1 })), installedVersionCode: 1 })).kind).toBe("open");
    expect((await runStartupCheck({ ...base, channel: undefined, io: io(async () => manifest), installedVersionCode: 1 })).kind).toBe("open");
  });

  it("gives up after the timeout instead of holding the app", async () => {
    const never = io(() => new Promise(() => undefined));
    expect((await runStartupCheck({ ...base, io: never, installedVersionCode: 1 }, 20)).kind).toBe("open");
  });
});
