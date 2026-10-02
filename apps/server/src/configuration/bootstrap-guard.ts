import type { InstallationConfiguration } from '@salesforce/domain';

/**
 * Refusals for a configuration file that is about to become the installation's current snapshot through the
 * one-shot `config-bootstrap` command (staging / production). The command is the only writer of the snapshot in
 * those environments; it must never carry the synthetic demo material of the development seed. Messages name the
 * rule and the field, never a value.
 *
 * `demoEmails` is the list of synthetic demo account addresses (`DEMO_ACCOUNTS`), supplied by the caller so that
 * this module stays free of the Sankhya package.
 */
export function bootstrapConfigurationProblems(
  configuration: InstallationConfiguration,
  demoEmails: readonly string[],
): string[] {
  const problems: string[] = [];
  const demo = new Set(demoEmails.map((email) => email.trim().toLowerCase()));
  configuration.customers.accountSellerLinks.forEach((link, index) => {
    if (demo.has(link.accountEmail.trim().toLowerCase())) {
      problems.push(`customers.accountSellerLinks.${index}.accountEmail: a demo account is refused (no demo accounts outside development).`);
    }
  });
  if (configuration.features['demoMetrics'] === true) {
    problems.push('features.demoMetrics: demo metrics are refused outside development.');
  }
  return problems;
}
