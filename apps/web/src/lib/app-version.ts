/** "0.2.0 · a1b2c3d": package version plus the short commit of the build; just the version when the commit is unknown. */
export function buildVersionLabel(version: string, commit: string): string {
  const short = commit.trim().toLowerCase().slice(0, 7);
  return /^[0-9a-f]{4,}$/.test(short) ? `${version} · ${short}` : version;
}

export const APP_VERSION_LABEL: string = buildVersionLabel(__APP_VERSION__, __APP_COMMIT__);
