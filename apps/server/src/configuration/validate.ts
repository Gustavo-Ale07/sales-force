import { InstallationConfigurationSchema } from '@salesforce/contracts';
import type { ConfigurationValidator } from '@salesforce/sankhya';

/**
 * Validates untrusted JSON as an `InstallationConfiguration`: the `packages/contracts` schema plus
 * the domain consistency rules it embeds. Messages carry the field path and the rule code, never the
 * offending value. Used for the bootstrap file source (U-11) and for payloads read back from storage.
 */
export const validateInstallationConfiguration: ConfigurationValidator = (raw) => {
  const result = InstallationConfigurationSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
};
