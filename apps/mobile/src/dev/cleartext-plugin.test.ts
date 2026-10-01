// Build-time guard of the DEV cleartext plugin (plain CommonJS, loaded outside the TypeScript program).
// Fail-closed: cleartext needs the explicit dev profile (SF_BUILD_PROFILE=dev); production/staging never qualify,
// and an unknown or missing profile is refused, not guessed.
const plugin = jest.requireActual("../../plugins/with-dev-cleartext") as {
  cleartextBuildProblem(env: Record<string, string | undefined>): string | null;
};

const DEV = { SF_ALLOW_CLEARTEXT: "1", SF_BUILD_PROFILE: "dev" };

describe("with-dev-cleartext build guard", () => {
  it("is silent when cleartext was not requested, whatever the profile", () => {
    expect(plugin.cleartextBuildProblem({})).toBeNull();
    expect(plugin.cleartextBuildProblem({ EAS_BUILD_PROFILE: "production" })).toBeNull();
    expect(plugin.cleartextBuildProblem({ EAS_BUILD_PROFILE: "staging", SF_BUILD_PROFILE: "staging" })).toBeNull();
  });

  it("allows an explicit local DEV build", () => {
    expect(plugin.cleartextBuildProblem(DEV)).toBeNull();
    expect(plugin.cleartextBuildProblem({ ...DEV, EAS_BUILD_PROFILE: "development" })).toBeNull();
    expect(plugin.cleartextBuildProblem({ ...DEV, APP_ENV: "development" })).toBeNull();
  });

  it("refuses cleartext without the explicit dev profile (fail-closed default)", () => {
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1" })).toMatch(/SF_BUILD_PROFILE=dev/);
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1", SF_BUILD_PROFILE: "" })).toMatch(/SF_BUILD_PROFILE=dev/);
  });

  it.each(["production", "staging", "release", "preview", "Production", "qa"])("refuses cleartext on the %s profile, whichever variable names it", (profile) => {
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1", SF_BUILD_PROFILE: profile })).toMatch(/SF_ALLOW_CLEARTEXT/);
    expect(plugin.cleartextBuildProblem({ ...DEV, EAS_BUILD_PROFILE: profile })).toMatch(/SF_ALLOW_CLEARTEXT/);
    expect(plugin.cleartextBuildProblem({ ...DEV, APP_ENV: profile })).toMatch(/SF_ALLOW_CLEARTEXT/);
  });

  it("refuses an ambiguous flag value instead of treating it as on or off", () => {
    for (const value of ["true", "0", "yes"]) {
      expect(plugin.cleartextBuildProblem({ ...DEV, SF_ALLOW_CLEARTEXT: value })).toMatch(/SF_ALLOW_CLEARTEXT/);
    }
  });
});
