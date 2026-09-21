import { ErrorState, ForbiddenState } from "@salesforce/ui";
import { describeApiError } from "../lib/error-message";
import { errorStatus } from "../lib/http-error";

export interface QueryErrorProps {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
  compact?: boolean;
}

/** Load failure of a data view: 403 -> forbidden state, anything else -> recoverable error with the correlation id. */
export function QueryError({ error, onRetry, retrying, title = "Não foi possível carregar", compact }: QueryErrorProps) {
  if (errorStatus(error) === 403) return <ForbiddenState compact={compact} />;
  const { title: heading, description, correlationId } = describeApiError(error, title);
  return (
    <ErrorState
      title={heading}
      description={description}
      correlationId={correlationId}
      onRetry={onRetry}
      retrying={retrying}
      compact={compact}
    />
  );
}
