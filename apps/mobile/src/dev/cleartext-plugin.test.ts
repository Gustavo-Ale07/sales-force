// Build-time guard of the DEV cleartext plugin (plain CommonJS, loaded outside the TypeScript program).
const plugin = jest.requireActual("../../plugins/with-dev-cleartext") as {
  cleartextBuildProblem(env: Record<string, string | undefined>): string | null;
};

describe("with-dev-cleartext build guard", () => {
  it("is silent when cleartext was not requested, whatever the profile", () => {
    expect(plugin.cleartextBuildProblem({})).toBeNull();
    expect(plugin.cleartextBuildProblem({ EAS_BUILD_PROFILE: "production" })).toBeNull();
  });

  it("allows an opted-in local DEV build", () => {
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1" })).toBeNull();
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "development" })).toBeNull();
  });

  it("refuses cleartext together with a production/release profile", () => {
    for (const profile of ["production", "release", "Production"]) {
      expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: profile })).toMatch(/SF_ALLOW_CLEARTEXT/);
    }
    expect(plugin.cleartextBuildProblem({ SF_ALLOW_CLEARTEXT: "1", APP_ENV: "production" })).toMatch(/SF_ALLOW_CLEARTEXT/);
  });
});
