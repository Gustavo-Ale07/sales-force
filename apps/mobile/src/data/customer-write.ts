import { callApi, type ApiClient } from "./api";
import type { SellerChoice, UpdateCustomerBody } from "./customer-form";

export type CustomerWriteState = "draft" | "awaiting_send" | "sent" | "needs_correction";

export interface UpdateCustomerResult {
  readonly state: CustomerWriteState;
  /** The server's own text of the state (one wording for site and app). */
  readonly stateLabel: string;
  /** The server's own words when the ERP refused ("Precisa de correção"). */
  readonly reasonMessage: string | null;
}

/** Online edit of a customer (`PATCH /customers/{code}`, D-AP). */
export interface CustomerWritePort {
  update(code: number, body: UpdateCustomerBody): Promise<UpdateCustomerResult>;
  /** Active sellers the actor may link a new customer to (`GET /sellers?active=true`); used only by a user who is not a seller. */
  activeSellers?(): Promise<readonly SellerChoice[]>;
}

export function createCustomerWritePort(api: ApiClient): CustomerWritePort {
  return {
    async update(code, body) {
      const response = await callApi(() => api.PATCH("/customers/{code}", { params: { path: { code } }, body }));
      return { state: response.state, stateLabel: response.stateLabel, reasonMessage: response.reasonMessage };
    },
    async activeSellers() {
      const response = await callApi(() => api.GET("/sellers", { params: { query: { active: "true" } } }));
      return response.items.filter((item) => item.active).map((item) => ({ code: item.code, name: item.name }));
    },
  };
}
