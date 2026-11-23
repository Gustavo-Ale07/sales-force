import type * as AppInfo from "./app-info";
import { APP_VERSION, buildLabel } from "./app-info";

describe("buildLabel", () => {
  it("shows the first 7 characters of the OTA update id when an update runs", () => {
    expect(buildLabel("0.1.0", { updateId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", isEmbeddedLaunch: false })).toBe("0.1.0 · atualização a1b2c3d");
  });

  it("says 'pacote do APK' for the embedded bundle, even when an id is present", () => {
    expect(buildLabel("0.1.0", { updateId: "a1b2c3d4-e5f6", isEmbeddedLaunch: true })).toBe("0.1.0 · pacote do APK");
  });

  it("says 'pacote do APK' when there is no update id (null or empty)", () => {
    expect(buildLabel("0.1.0", { updateId: null, isEmbeddedLaunch: false })).toBe("0.1.0 · pacote do APK");
    expect(buildLabel("0.1.0", { updateId: "", isEmbeddedLaunch: false })).toBe("0.1.0 · pacote do APK");
  });
});

describe("APP_BUILD_LABEL", () => {
  afterEach(() => {
    jest.dontMock("expo-updates");
    jest.resetModules();
  });

  function load(): typeof AppInfo {
    let loaded: typeof AppInfo | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require("./app-info") as typeof AppInfo;
    });
    return loaded as typeof AppInfo;
  }

  it("uses the running OTA update id", () => {
    jest.doMock("expo-updates", () => ({ updateId: "0123456789abcdef", isEmbeddedLaunch: false }));
    expect(load().APP_BUILD_LABEL).toBe(`${APP_VERSION} · atualização 0123456`);
  });

  it("falls back to 'pacote do APK' when the native module is missing (require throws)", () => {
    jest.doMock("expo-updates", () => {
      throw new Error("Cannot find native module 'ExpoUpdates'");
    });
    expect(load().APP_BUILD_LABEL).toBe(`${APP_VERSION} · pacote do APK`);
  });

  it("falls back to 'pacote do APK' when the module is inert (no fields)", () => {
    jest.doMock("expo-updates", () => ({}));
    expect(load().APP_BUILD_LABEL).toBe(`${APP_VERSION} · pacote do APK`);
  });
});
