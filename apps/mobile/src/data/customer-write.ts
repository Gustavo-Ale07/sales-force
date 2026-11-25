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

/** One registration made through Sales Force, as the server lists it (`GET /customers/registrations`). */
export interface CustomerRegistration {
  readonly registrationId: string;
  readonly state: CustomerWriteState;
  readonly stateLabel: string;
  readonly customerCode: number | null;
  /** Digits only. */
  readonly document: string;
  readonly name: string;
  readonly reasonMessage: string | null;
  readonly createdAt: string;
}

/** Online edit of a customer (`PATCH /customers/{code}`, D-AP) and the registrations list (D-AR). */
export interface CustomerWritePort {
  update(code: number, body: UpdateCustomerBody): Promise<UpdateCustomerResult>;
  registrations(): Promise<readonly CustomerRegistration[]>;
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
    async registrations() {
      const response = await callApi(() => api.GET("/customers/registrations", { params: { query: { limit: 50 } } }));
      return response.items.map((item) => ({
        registrationId: item.registrationId,
        state: item.state,
        stateLabel: item.stateLabel,
        customerCode: item.customerCode,
        document: item.document,
        name: item.name,
        reasonMessage: item.reasonMessage,
        createdAt: item.createdAt,
      }));
    },
  };
}
