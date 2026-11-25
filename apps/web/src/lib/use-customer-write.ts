import type { ApiSchema } from "@salesforce/contracts/client";
import { customerStateLabel } from "@salesforce/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCustomer, updateCustomer } from "./api-mutations";
import { orderEntryConfigurationQueryOptions, queryKeys } from "./api-queries";
import { useApi } from "./app-context";
import { buildCreateBody, buildUpdateBody, isUnknownOutcome, type CreateForm, type EditForm } from "./customer-form";
import { errorStatus } from "./http-error";
import { useRef } from "react";

/**
 * The state text comes from the server (`stateLabel`, one wording in packages/domain for site and app); the create answer carries only
 * the state, so the same domain function names it. Never composed here.
 */
export const createStateLabel = (state: ApiSchema<"CreateCustomerResponse">["state"]): string => customerStateLabel(state);

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

/** `correctsRegistrationId`: the refused registration this one corrects (always a new request id). */
export function useCreateCustomer(correctsRegistrationId?: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const requestId = useRef<string | null>(null);
  const signature = useRef<string>("");
  return useMutation({
    mutationFn: (form: CreateForm) => {
      const current = JSON.stringify(buildCreateBody("", form, correctsRegistrationId));
      if (!requestId.current || signature.current !== current) requestId.current = newUuid();
      signature.current = current;
      return createCustomer(api, buildCreateBody(requestId.current, form, correctsRegistrationId));
    },
    onSuccess: () => {
      requestId.current = null;
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerRegistrations });
    },
    onError: (error) => {
      if (!isUnknownOutcome(error)) requestId.current = null;
    },
  });
}
