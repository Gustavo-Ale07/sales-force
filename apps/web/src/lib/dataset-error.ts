import type { ErrorDescription } from "./error-message";

export const DATASET_MISMATCH = "dataset_mismatch";

/**
 * The dataset identity travels explicitly with every order write (`expectedDataset`): it is the one the screen LOADED
 * under (the order-entry configuration it priced with), never a fresh read at submit time. There is no bypass: when the
 * identity is unknown (not loaded, or the server declares none) the write is not sent at all.
 */
export class DatasetUnavailableError extends Error {
  readonly reason: "not_loaded" | "undeclared";
  constructor(reason: "not_loaded" | "undeclared") {
    super(reason === "undeclared" ? "dataset undeclared" : "dataset not loaded");
    this.name = "DatasetUnavailableError";
    this.reason = reason;
  }
}

/** pt-BR text for the two dataset failures; `null` for any other error. */
export function describeDatasetError(error: unknown): ErrorDescription | null {
  if (error instanceof DatasetUnavailableError) {
    return error.reason === "undeclared"
      ? {
          title: "Dados não confirmados",
          description: "Nada foi gravado. Recarregue a página; se continuar, avise o suporte.",
        }
      : {
          title: "Dados não confirmados",
          description: "Nada foi gravado. Recarregue a página e tente de novo.",
        };
  }
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === DATASET_MISMATCH) {
    return {
      title: "Dados desatualizados",
      description: "O servidor mudou desde que você abriu o pedido. Recarregue a página e abra o pedido de novo.",
      correlationId: (error as { correlationId?: string }).correlationId,
    };
  }
  return null;
}
