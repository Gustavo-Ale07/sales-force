import { SANDBOX_WRITE_HOSTS, writeHostRefusal } from './host-allowlist.js';

/**
 * The single typed reader of the profile-photo write switch. Only the worker process uses it (STACK-2).
 *
 * `SANKHYA_PROFILE_PHOTO_WRITE_ENABLED` (`true`|`false`, default `false`). When `true` it is accepted ONLY with all of:
 *  - `SF_DEPLOY_ENVIRONMENT=staging` (explicit; production or unset is refused, never production);
 *  - `SANKHYA_MODE=live` against `SANKHYA_ENVIRONMENT=sandbox` (explicit);
 *  - `SANKHYA_BASE_URL` exactly one of the Sandbox write hosts fixed in code (SNK-3, SNK-6).
 * Any violation becomes a boot problem and the worker refuses to start. While closed nothing else is checked.
 */
export interface ProfilePhotoWriteSettings {
  readonly enabled: boolean;
}

export const PROFILE_PHOTO_WRITE_DISABLED: ProfilePhotoWriteSettings = Object.freeze({ enabled: false });

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

export function parseProfilePhotoWriteSettings(env: Env): { settings: ProfilePhotoWriteSettings; problems: string[] } {
  const raw = value(env, 'SANKHYA_PROFILE_PHOTO_WRITE_ENABLED');
  if (raw === undefined || raw === 'false') return { settings: PROFILE_PHOTO_WRITE_DISABLED, problems: [] };
  if (raw !== 'true') {
    return { settings: PROFILE_PHOTO_WRITE_DISABLED, problems: ["SANKHYA_PROFILE_PHOTO_WRITE_ENABLED must be 'true' or 'false' (default false)."] };
  }
  const problems: string[] = [];
  if (value(env, 'SF_DEPLOY_ENVIRONMENT')?.toLowerCase() !== 'staging') {
    problems.push('SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=true requires an explicit SF_DEPLOY_ENVIRONMENT=staging; production or unset is refused (the photo write never runs in production).');
  }
  if (value(env, 'SANKHYA_MODE')?.toLowerCase() !== 'live') {
    problems.push('SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=true requires SANKHYA_MODE=live (the real adapter against the Sandbox).');
  }
  if (value(env, 'SANKHYA_ENVIRONMENT')?.toLowerCase() !== 'sandbox') {
    problems.push("SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=true is refused unless SANKHYA_ENVIRONMENT is explicitly 'sandbox' (SNK-3, SNK-6).");
  }
  const baseUrl = value(env, 'SANKHYA_BASE_URL');
  if (baseUrl === undefined || writeHostRefusal(baseUrl) !== null) {
    problems.push(`SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=true requires SANKHYA_BASE_URL to be exactly one of the Sandbox write hosts fixed in code (${SANDBOX_WRITE_HOSTS.length} allowed).`);
  }
  return { settings: { enabled: problems.length === 0 }, problems };
}

/** Health-page text; carries no host, credential or identifier. */
export function describeProfilePhotoWrite(settings: ProfilePhotoWriteSettings): string {
  return settings.enabled ? 'escrita de foto de perfil: ligada (Sandbox)' : 'escrita de foto de perfil: desligada';
}
