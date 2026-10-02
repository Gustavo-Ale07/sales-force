// Build-time guard of the staging variant (plain CommonJS module). Fail-closed: any doubt refuses to configure.
type Env = Record<string, string | undefined>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- config shape is Expo's loose JSON
type Cfg = Record<string, any>;
const variant = jest.requireActual("../../app-variant") as {
  applyVariant(config: Cfg, env?: Env): Cfg;
  stagingProblems(env: Env, config?: Cfg): string[];
};

const STG = { APP_VARIANT: "staging", EXPO_PUBLIC_API_URL: "https://force-staging.sistemasplac.com.br" };
const base: Cfg = {
  name: "Force",
  scheme: "salesforce",
  ios: { bundleIdentifier: "br.com.plac.salesforce.dev" },
  android: { package: "br.com.plac.salesforce.dev" },
  extra: { notice: "x" },
};

describe("app variant", () => {
  it("leaves the base config untouched for development or no variant", () => {
    expect(variant.applyVariant(base, {})).toBe(base);
    expect(variant.applyVariant(base, { APP_VARIANT: "development" })).toBe(base);
    expect(variant.applyVariant(base, { APP_VARIANT: "development", EXPO_PUBLIC_API_URL: "http://192.168.0.10:3000", SF_ALLOW_CLEARTEXT: "1" })).toBe(base);
  });

  it("rejects unknown variants, including production", () => {
    expect(() => variant.applyVariant(base, { APP_VARIANT: "production" })).toThrow(/Unknown APP_VARIANT/);
    expect(() => variant.applyVariant(base, { APP_VARIANT: "stagin" })).toThrow(/Unknown APP_VARIANT/);
  });

  it("configures staging identity and keeps the base config unmodified", () => {
    const out = variant.applyVariant(base, STG);
    expect(out.android.package).toBe("br.com.plac.salesforce.staging");
    expect(out.android.allowBackup).toBe(false);
    expect(out.ios.bundleIdentifier).toBe("br.com.plac.salesforce.staging");
    expect(out.name).toBe("Sales Force STG");
    expect(out.scheme).toBe("salesforce-stg");
    expect(out.extra).toEqual({ appVariant: "staging" });
    expect(base.android.package).toBe("br.com.plac.salesforce.dev");
  });

  it("accepts an https origin with a port and a public 172.x outside the private range", () => {
    expect(variant.stagingProblems({ ...STG, EXPO_PUBLIC_API_URL: "https://api.example.com:8443" })).toEqual([]);
    expect(variant.stagingProblems({ ...STG, EXPO_PUBLIC_API_URL: "https://172.32.0.1" })).toEqual([]);
  });

  it("accepts the staging build profile name", () => {
    expect(variant.stagingProblems({ ...STG, SF_BUILD_PROFILE: "staging", EXPO_PUBLIC_BUILD_PROFILE: "staging" })).toEqual([]);
  });

  it("refuses a missing API URL", () => {
    expect(() => variant.applyVariant(base, { APP_VARIANT: "staging" })).toThrow(/EXPO_PUBLIC_API_URL is empty/);
  });

  it.each([
    "", "   ", "http://force-staging.sistemasplac.com.br", "force-staging.sistemasplac.com.br", "https://force-staging.sistemasplac.com.br/api",
    "https://localhost", "https://localhost:3000", "https://127.0.0.1", "https://10.0.2.2:3000", "https://10.1.2.3", "https://192.168.0.10",
    "https://172.16.0.1", "https://172.31.255.1", "https://169.254.1.1", "https://[::1]", "https://[fd00::1]", "https://intranet", "https://pc.local",
    "https://user@host.example.com", "https://2130706433", "https://0x7f000001",
  ])("refuses API URL %j", (url) => {
    expect(() => variant.applyVariant(base, { ...STG, EXPO_PUBLIC_API_URL: url })).toThrow(/Refusing to configure the staging build/);
  });

  it.each([
    { SF_ALLOW_CLEARTEXT: "1" }, { SF_ALLOW_CLEARTEXT: "0" }, { EXPO_PUBLIC_ALLOW_CLEARTEXT: "1" },
    { SF_BUILD_PROFILE: "dev" }, { EXPO_PUBLIC_BUILD_PROFILE: "development" }, { SF_DEBUG_SIGNING: "1" },
    { SF_ANDROID_KEYSTORE: "C:/x/debug.keystore" }, { ANDROID_KEYSTORE_PATH: "./android/app/debug.keystore" },
  ])("refuses unsafe environment %j", (extra) => {
    expect(() => variant.applyVariant(base, { ...STG, ...extra })).toThrow(/Refusing to configure the staging build/);
  });

  it("refuses debug signing in the Android config", () => {
    expect(() => variant.applyVariant({ ...base, android: { package: "x", debugSigning: true } }, STG)).toThrow(/debug signing/);
    expect(() => variant.applyVariant({ ...base, android: { package: "x", signing: "debug.keystore" } }, STG)).toThrow(/debug signing/);
  });
});
