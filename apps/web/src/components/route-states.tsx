import { Button, EmptyState, ErrorState, ForbiddenState, SkeletonLines } from "@salesforce/ui";
import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { correlationIdOf, errorStatus } from "../lib/http-error";

/** Route-level loading fallback (shown after `defaultPendingMs`). */
export function RoutePending() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <SkeletonLines lines={2} label="Carregando página…" className="max-w-sm" />
      <SkeletonLines lines={6} label="Carregando conteúdo…" />
    </div>
  );
}

/** Route-level error boundary: 403 -> forbidden state, everything else -> recoverable error with retry. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (errorStatus(error) === 403) return <ForbiddenState />;
  return (
    <ErrorState
      correlationId={correlationIdOf(error)}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

export function NotFound() {
  return (
    <EmptyState
      icon={<Compass size={16} />}
      title="Página não encontrada"
      description="O endereço não existe ou foi movido. Volte ao início e tente novamente."
      action={
        <Button asChild variant="primary" size="sm">
          <Link to="/">Ir para o início</Link>
        </Button>
      }
    />
  );
}
