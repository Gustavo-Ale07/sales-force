// Staging only: fail the Gradle release build when the release buildType is signed with the debug keystore.
// Why: `expo prebuild` generates `release { signingConfig signingConfigs.debug }`. On EAS (remote credentials) EAS replaces
// it with the managed keystore before Gradle runs; a local `gradlew assembleRelease`, or an EAS build without credentials,
// would otherwise silently produce a debug-signed staging APK. The check runs at task-graph time, after any EAS injection.
// Inactive unless APP_VARIANT=staging at prebuild time, so the development flow is unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo config plugins are CommonJS
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// sf-staging-signing-guard";
const BLOCK = `
${MARKER}
gradle.taskGraph.whenReady { graph ->
    def releaseSigning = android.buildTypes.release.signingConfig
    def debugSigned = releaseSigning == null || releaseSigning.name == 'debug' || (releaseSigning.storeFile != null && releaseSigning.storeFile.name == 'debug.keystore')
    def releaseTask = graph.allTasks.find { it.path.startsWith(':app:') && it.name ==~ /(assemble|bundle|package)Release/ }
    if (releaseTask != null && debugSigned) {
        throw new GradleException("Staging release build refused: the release buildType is signed with the debug keystore (or has no signing config). Build through EAS with managed credentials (eas build --profile staging).")
    }
}
`;

/** Returns the build.gradle text with the guard appended once. Pure. */
function addSigningGuard(contents) {
  return contents.includes(MARKER) ? contents : `${contents.replace(/\s*$/, "\n")}${BLOCK}`;
}

function withStagingSigningGuard(config) {
  if ((process.env.APP_VARIANT ?? "").trim().toLowerCase() !== "staging") return config;
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addSigningGuard(mod.modResults.contents);
    return mod;
  });
}

module.exports = withStagingSigningGuard;
module.exports.addSigningGuard = addSigningGuard;
