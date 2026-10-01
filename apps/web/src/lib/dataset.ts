import type { ApiSchema } from "@salesforce/contracts/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { orderEntryConfigurationQueryOptions } from "./api-queries";
import { useApi } from "./app-context";
import { DatasetUnavailableError } from "./dataset-error";

export type DatasetIdentity = ApiSchema<"DatasetIdentity">;

export type LoadedDataset =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dataset: DatasetIdentity | null };

/**
 * Order-entry configuration of this screen, with its dataset frozen at the first successful load: a later background
 * refetch never changes the identity the screen sends (a server switched to another dataset must be answered by 409,
 * not silently followed).
 */
export function useLoadedDataset(): LoadedDataset {
  const api = useApi();
  const query = useQuery(orderEntryConfigurationQueryOptions(api));
  const [frozen, setFrozen] = useState<{ dataset: DatasetIdentity | null } | null>(null);
  if (frozen === null && query.data !== undefined) setFrozen({ dataset: query.data.dataset });
  const first = frozen ?? (query.data !== undefined ? { dataset: query.data.dataset } : null);
  if (first !== null) return { status: "ready", dataset: first.dataset };
  return query.isError ? { status: "error" } : { status: "loading" };
}

/** The identity to send, or a `DatasetUnavailableError` (nothing is sent). */
export function requireDataset(loaded: LoadedDataset): DatasetIdentity {
  if (loaded.status !== "ready") throw new DatasetUnavailableError("not_loaded");
  if (loaded.dataset === null) throw new DatasetUnavailableError("undeclared");
  return loaded.dataset;
}
