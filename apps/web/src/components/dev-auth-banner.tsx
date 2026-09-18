import { Banner } from "@salesforce/ui";
import { useAppServices } from "../lib/app-context";

export const DEV_AUTH_NOTICE = "Ambiente de desenvolvimento — autenticação de desenvolvimento, não usar em produção";

/** Always visible while development authentication is active (login page and application shell). */
export function DevAuthBanner({ className }: { className?: string }) {
  const { config } = useAppServices();
  if (config.authMode !== "dev") return null;
  return (
    // Permanent notice, not an interruption: status, so it does not compete with the login error alert.
    <Banner tone="warning" role="status" className={className} data-testid="dev-auth-banner">
      <span className="font-medium">{DEV_AUTH_NOTICE}</span>
    </Banner>
  );
}
