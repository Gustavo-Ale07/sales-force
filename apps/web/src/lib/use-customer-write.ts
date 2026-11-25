import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCustomer, updateCustomer } from "./api-mutations";
import { orderEntryConfigurationQueryOptions, queryKeys } from "./api-queries";
import { useApi } from "./app-context";
import { buildCreateBody, buildUpdateBody, isUnknownOutcome, type CreateForm, type EditForm } from "./customer-form";
import { errorStatus } from "./http-error";
import { useRef } from "react";

/** What the installation released for customers; absent or false is "not released". Re-read when the screen opens. */
export function useCustomerWriteFlags() {
  const api = useApi();
  const query = useQuery({ ...orderEntryConfigurationQueryOptions(api), staleTime: 5 * 60_000 });
  return {
    canEdit: query.data?.general.clientEditEnabled === true,
    canCreate: query.data?.general.clientCreationEnabled === true,
  };
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The request id is kept while the previous attempt ended without a definitive answer (network, 5xx, 429), so a retry after a lost
 * response is the same request; it is dropped on success and on every definitive answer.
 */
export function useUpdateCustomer(customerCode: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  const requestId = useRef<string | null>(null);
  const signature = useRef<string>("");
  return useMutation({
    mutationFn: (form: EditForm) => {
      // A changed form is a different request: reusing the id would be an idempotency conflict.
      const current = JSON.stringify(buildUpdateBody("", form));
      if (!requestId.current || signature.current !== current) requestId.current = newUuid();
      signature.current = current;
      return updateCustomer(api, customerCode, buildUpdateBody(requestId.current, form));
    },
    onSuccess: () => {
      requestId.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerCode) });
    },
    onError: (error) => {
      if (!isUnknownOutcome(error)) requestId.current = null;
      if (errorStatus(error) === 404) void queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerCode) });
    },
  });
}

/** Creates the customer in Sankhya at once: the mutation stays pending until the server answers. */
export function useCreateCustomer() {
  const api = useApi();
  const queryClient = useQueryClient();
  const requestId = useRef<string | null>(null);
  const signature = useRef<string>("");
  return useMutation({
    mutationFn: (form: CreateForm) => {
      const current = JSON.stringify(buildCreateBody("", form));
      if (!requestId.current || signature.current !== current) requestId.current = newUuid();
      signature.current = current;
      return createCustomer(api, buildCreateBody(requestId.current, form));
    },
    onSuccess: () => {
      requestId.current = null;
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error) => {
      if (!isUnknownOutcome(error)) requestId.current = null;
    },
  });
}
