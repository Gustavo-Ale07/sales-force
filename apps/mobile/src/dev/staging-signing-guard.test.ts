// The staging signing guard appended to the generated app/build.gradle (plain CommonJS plugin).
const guardPlugin = jest.requireActual("../../plugins/with-staging-signing-guard") as {
  addSigningGuard(contents: string): string;
};

describe("with-staging-signing-guard", () => {
  const gradle = "android {\n  buildTypes {\n    release { signingConfig signingConfigs.debug }\n  }\n}\n";

  it("appends a task-graph check that refuses debug-signed release builds", () => {
    const out = guardPlugin.addSigningGuard(gradle);
    expect(out.startsWith(gradle)).toBe(true);
    expect(out).toContain("gradle.taskGraph.whenReady");
    expect(out).toContain("releaseSigning.name == 'debug'");
    expect(out).toContain("debug.keystore");
    expect(out).toContain("throw new GradleException");
  });

  it("is idempotent", () => {
    const once = guardPlugin.addSigningGuard(gradle);
    expect(guardPlugin.addSigningGuard(once)).toBe(once);
  });
});
