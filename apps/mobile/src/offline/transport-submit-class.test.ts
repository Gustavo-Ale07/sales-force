import { TransportError } from "@salesforce/mobile-db";
import { ERROR_CATALOG } from "../data/error-catalog";
import { ApiRequestError } from "../data/api";
import { SUBMIT_FAILURE_CLASS, submitFailureClass, toSubmitError } from "./transport";

const api = (init: ConstructorParameters<typeof ApiRequestError>[0]) => new ApiRequestError(init);

/** One row per HTTP answer of POST /orders/{id}/submit: the catalog code the seller sees, and the class that decides resend vs popup-only. */
const ANSWERS: ReadonlyArray<{ name: string; error: unknown; key: string; klass: "transient" | "definitive" }> = [
  { name: "no connection", error: api({ status: 0, message: "x" }), key: "network", klass: "transient" },
  { name: "session expired", error: api({ status: 401, message: "x" }), key: "auth", klass: "transient" },
  { name: "rate limited", error: api({ status: 429, message: "x" }), key: "rate_limit", klass: "transient" },
  { name: "server 500", error: api({ status: 500, message: "x" }), key: "server", klass: "transient" },
  { name: "server 503", error: api({ status: 503, message: "x" }), key: "server", klass: "transient" },
  { name: "unexpected non-API error", error: new Error("boom"), key: "server", klass: "transient" },
  { name: "submission switch off", error: api({ status: 409, code: "erp_submission_disabled", message: "x" }), key: "erp_submission_disabled", klass: "definitive" },
  { name: "discount above authority", error: api({ status: 409, code: "discount_blocked", message: "x" }), key: "discount_blocked", klass: "definitive" },
  { name: "customer without seller (5020)", error: api({ status: 409, code: "customer_without_seller", message: "x" }), key: "customer_without_seller", klass: "definitive" },
  { name: "customer inactive", error: api({ status: 409, code: "customer_ineligible", reason: "customer_inactive", message: "x" }), key: "customer_inactive", klass: "definitive" },
  { name: "customer blocked", error: api({ status: 409, code: "customer_ineligible", reason: "customer_blocked", message: "x" }), key: "customer_blocked", klass: "definitive" },
  { name: "customer pending approval", error: api({ status: 409, code: "customer_ineligible", reason: "customer_pending", message: "x" }), key: "customer_pending", klass: "definitive" },
  { name: "customer ineligible without a known cause", error: api({ status: 409, code: "customer_ineligible", message: "x" }), key: "customer_ineligible", klass: "definitive" },
  { name: "version conflict", error: api({ status: 409, code: "version_conflict", message: "x" }), key: "version_conflict", klass: "definitive" },
  { name: "order not editable", error: api({ status: 409, code: "order_not_editable", message: "x" }), key: "order_not_editable", klass: "definitive" },
  { name: "dataset mismatch", error: api({ status: 409, code: "dataset_mismatch", message: "x" }), key: "dataset_mismatch", klass: "definitive" },
  { name: "edit before resubmitting", error: api({ status: 409, code: "conflict", reason: "edit_before_resubmitting", message: "x" }), key: "edit_before_resubmitting", klass: "definitive" },
  { name: "needs manager approval", error: api({ status: 409, code: "conflict", reason: "needs_manager_approval", message: "x" }), key: "needs_manager_approval", klass: "definitive" },
  { name: "approval required before resend", error: api({ status: 409, code: "conflict", reason: "approval_required_before_resend", message: "x" }), key: "approval_required_before_resend", klass: "definitive" },
  { name: "order in an invalid status", error: api({ status: 409, code: "conflict", reason: "invalid_status", message: "x" }), key: "invalid_status", klass: "definitive" },
  { name: "legacy dataset", error: api({ status: 409, code: "conflict", reason: "legacy_dataset", message: "x" }), key: "legacy_dataset", klass: "definitive" },
  { name: "dataset not ERP", error: api({ status: 409, code: "conflict", reason: "dataset_not_erp", message: "x" }), key: "dataset_not_erp", klass: "definitive" },
  { name: "environment unbound", error: api({ status: 409, code: "conflict", reason: "environment_unbound", message: "x" }), key: "environment_unbound", klass: "definitive" },
  { name: "environment mismatch", error: api({ status: 409, code: "conflict", reason: "environment_mismatch", message: "x" }), key: "environment_mismatch", klass: "definitive" },
  { name: "delivery diverged", error: api({ status: 409, code: "conflict", reason: "delivery_diverged", message: "x" }), key: "delivery_diverged", klass: "definitive" },
  { name: "ambiguous origin", error: api({ status: 409, code: "conflict", reason: "ambiguous_origin", message: "x" }), key: "ambiguous_origin", klass: "definitive" },
  { name: "header not eligible (TOP)", error: api({ status: 400, message: "x", issues: [{ path: "topCode", code: "order_top_not_eligible" }] }), key: "header_not_eligible", klass: "definitive" },
  { name: "header not eligible (carrier)", error: api({ status: 400, message: "x", issues: [{ path: "carrierCode", code: "missing_carrier" }] }), key: "header_not_eligible", klass: "definitive" },
  { name: "validation issue on an item", error: api({ status: 400, message: "x", issues: [{ path: "items.0", code: "invalid_discount" }] }), key: "validation_failed", klass: "definitive" },
  { name: "not found", error: api({ status: 404, message: "x" }), key: "not_found", klass: "definitive" },
  { name: "forbidden", error: api({ status: 403, message: "x" }), key: "forbidden", klass: "definitive" },
  { name: "validation_failed code without issues", error: api({ status: 422, code: "validation_failed", message: "x" }), key: "validation_failed", klass: "definitive" },
  { name: "unmapped 4xx", error: api({ status: 418, message: "x" }), key: "send_refused", klass: "definitive" },
  { name: "unknown 409 reason", error: api({ status: 409, code: "conflict", reason: "something_new", message: "x" }), key: "send_refused", klass: "definitive" },
];

describe("POST /orders/{id}/submit failure classes (SUBMIT_FAILURE_CLASS)", () => {
  it.each(ANSWERS)("$name -> $key is $klass", ({ error, key, klass }) => {
    const mapped = toSubmitError(error);
    expect(mapped).toBeInstanceOf(TransportError);
    expect(mapped.kind === "send_refused" ? (mapped.reason ?? "send_refused") : mapped.kind).toBe(key);
    expect(submitFailureClass(error)).toBe(klass);
    expect(SUBMIT_FAILURE_CLASS[key]).toBe(klass);
  });

  it("covers every entry of the table: no class is untested", () => {
    const covered = new Set(ANSWERS.map((a) => a.key));
    expect([...Object.keys(SUBMIT_FAILURE_CLASS)].filter((k) => !covered.has(k))).toEqual([]);
  });

  it("only network, auth, rate_limit and server are transient: the resend loop never runs on a refusal", () => {
    const transient = Object.entries(SUBMIT_FAILURE_CLASS).filter(([, v]) => v === "transient").map(([k]) => k).sort();
    expect(transient).toEqual(["auth", "network", "rate_limit", "server"]);
  });

  it("an unknown reason is definitive (never an endless blind retry)", () => {
    expect(submitFailureClass(new TransportError("send_refused", "x", 409, "brand_new_reason"))).toBe("definitive");
  });

  it("every definitive reason has a catalog entry (the seller always gets a popup text)", () => {
    const missing = Object.entries(SUBMIT_FAILURE_CLASS)
      .filter(([, v]) => v === "definitive")
      .map(([k]) => k)
      .filter((k) => !Object.hasOwn(ERROR_CATALOG, k));
    expect(missing).toEqual([]);
  });

  it("a customer without a seller carries the seller text and the 'Trocar cliente' catalog action", () => {
    const mapped = toSubmitError(api({ status: 409, code: "customer_without_seller", message: "x" }));
    expect(mapped.message).toMatch(/vendedor/);
    expect((ERROR_CATALOG as Record<string, { action: string }>).customer_without_seller?.action).toBe("change_customer");
  });
});
