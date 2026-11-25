import { callApi, type ApiClient } from "./api";
import type { UpdateCustomerBody } from "./customer-form";

export type CustomerWriteState = "draft" | "awaiting_send" | "sent" | "needs_correction";

export interface UpdateCustomerResult {
  readonly state: CustomerWriteState;
  /** The server's own words when the ERP refused ("Precisa de correção"). */
  readonly reasonMessage: string | null;
}

/** Online edit of a customer (`PATCH /customers/{code}`, D-AP). Always refused by the server until the delivery is approved. */
export interface CustomerWritePort {
  update(code: number, body: UpdateCustomerBody): Promise<UpdateCustomerResult>;
}

export function createCustomerWritePort(api: ApiClient): CustomerWritePort {
  return {
    async update(code, body) {
      const response = await callApi(() =>
        api.PATCH("/customers/{code}", {
          params: { path: { code } },
          body: { ...body, ...(body.contacts === undefined ? {} : { contacts: body.contacts.map((contact) => ({ ...contact })) }) },
        }),
      );
      return { state: response.state, reasonMessage: response.reasonMessage };
    },
  };
}
