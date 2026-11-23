import {
  CUSTOMER_BLOCK_MESSAGES,
  CUSTOMER_UNAVAILABLE_MESSAGE,
  DatasetChangedError,
  LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE,
  PRODUCT_BLOCK_MESSAGES,
  TransportError,
} from "@salesforce/mobile-db";
import { ApiRequestError } from "./api";
import { ACTION_LABELS, codeOfHeldMessage, describeProblem, ERROR_CATALOG, problemForCode } from "./error-catalog";
import { PriceTableNotDownloadedError } from "./errors";

describe("describeProblem — ApiRequestError", () => {
  it("a network failure is 'Sem conexão' with a retry action", () => {
    const problem = describeProblem(new ApiRequestError({ status: 0, message: "timeout" }));
    expect(problem).toMatchObject({ code: "offline", title: "Sem conexão", action: "retry" });
  });

  it("keeps the technical text out of title and message and puts it in details", () => {
    const problem = describeProblem(new ApiRequestError({ status: 500, message: "SQLSTATE 23505 secret detail", correlationId: "corr-1" }));
    expect(problem.code).toBe("internal_error");
    expect(problem.title + problem.message).not.toMatch(/SQLSTATE/);
    expect(problem.details).toContain("Status: 500");
    expect(problem.details).toContain("SQLSTATE 23505 secret detail");
    expect(problem.details).toContain("Protocolo: corr-1");
  });

  it("maps a known server code to its catalog text", () => {
    const problem = describeProblem(new ApiRequestError({ status: 409, code: "version_conflict", message: "x" }));
    expect(problem).toMatchObject({ code: "version_conflict", title: "Pedido alterado em outro lugar", action: "reload" });
  });

  it("idempotency_conflict is 'Pedido antigo'", () => {
    const problem = describeProblem(new ApiRequestError({ status: 409, code: "idempotency_conflict", message: "x" }));
    expect(problem).toMatchObject({ code: "idempotency_conflict", title: "Pedido antigo", action: "none" });
  });

  it.each([
    ["customer_inactive", "Cliente inativo"],
    ["customer_blocked", "Cliente bloqueado"],
    ["customer_without_seller", "Cliente sem vendedor"],
    ["customer_pending", "Cliente em análise"],
  ])("customer_ineligible with reason %s says the specific cause and offers to change the customer", (reason, title) => {
    const problem = describeProblem(new ApiRequestError({ status: 409, code: "customer_ineligible", reason, message: "x" }));
    expect(problem).toMatchObject({ code: reason, title, action: "change_customer" });
    expect(problem.details).toContain(`Motivo: ${reason}`);
  });

  it("customer_ineligible with an unknown reason falls to the generic customer text", () => {
    const problem = describeProblem(new ApiRequestError({ status: 409, code: "customer_ineligible", reason: "something_new", message: "x" }));
    expect(problem).toMatchObject({ code: "customer_ineligible", title: "Cliente indisponível", action: "change_customer" });
  });

  it("an issues list becomes 'Corrija os itens', one line per issue with the item number", () => {
    const problem = describeProblem(
      new ApiRequestError({
        status: 422,
        code: "validation_failed",
        message: "x",
        issues: [
          { path: "items[0].discountPercent", code: "invalid_discount" },
          { path: "items[2].quantity", code: "unknown_code", message: "Quantidade inválida." },
        ],
      }),
    );
    expect(problem.title).toBe("Corrija os itens");
    expect(problem.code).toBe("validation_failed");
    expect(problem.message).toBe("Item 1: Desconto inválido.\nItem 3: Quantidade inválida.");
    expect(problem.details).toContain("Item: items[0].discountPercent invalid_discount");
  });

  it("rate limit (429) says how long to wait when the server says so", () => {
    const withWait = describeProblem(new ApiRequestError({ status: 429, message: "x", retryAfterSeconds: 30 }));
    expect(withWait).toMatchObject({ code: "rate_limited", title: "Muitas tentativas", action: "retry" });
    expect(withWait.message).toContain("Espere 30 s.");
    const without = describeProblem(new ApiRequestError({ status: 429, message: "x" }));
    expect(without.message).toBe(ERROR_CATALOG.rate_limited.message);
  });

  it.each([
    [401, "unauthenticated", "sign_in"],
    [403, "forbidden", "none"],
    [404, "not_found", "go_sync"],
    [503, "service_unavailable", "retry"],
    [502, "internal_error", "retry"],
  ])("status %i without a known code maps to %s", (status, code, action) => {
    expect(describeProblem(new ApiRequestError({ status, message: "x" }))).toMatchObject({ code, action });
  });

  it("an unknown 4xx falls to the generic popup", () => {
    expect(describeProblem(new ApiRequestError({ status: 418, code: "teapot", message: "x" }))).toMatchObject({ code: "unexpected", title: "Algo deu errado" });
  });
});

describe("describeProblem — TransportError", () => {
  it.each([
    ["network", "offline"],
    ["auth", "unauthenticated"],
    ["rate_limit", "rate_limited"],
    ["server", "service_unavailable"],
    ["validation", "validation_failed"],
  ] as const)("kind %s maps to %s", (kind, code) => {
    expect(describeProblem(new TransportError(kind, "boom"))).toMatchObject({ code });
  });

  it("customer_ineligible keeps the specific reason when it is known", () => {
    const problem = describeProblem(new TransportError("customer_ineligible", "x", 409, "customer_blocked"));
    expect(problem).toMatchObject({ code: "customer_blocked", title: "Cliente bloqueado", action: "change_customer" });
    expect(describeProblem(new TransportError("customer_ineligible", "x", 409, "nope")).code).toBe("customer_ineligible");
  });

  it("registration_refused is the refused-registration popup without a fixing action", () => {
    expect(describeProblem(new TransportError("registration_refused", "x"))).toMatchObject({ code: "registration_refused", action: "none" });
  });
});

describe("describeProblem — other errors", () => {
  it("local engine errors have their own seller text", () => {
    expect(describeProblem(new PriceTableNotDownloadedError()).code).toBe("price_table_missing");
    expect(describeProblem(new DatasetChangedError("changed")).code).toBe("dataset_changed");
  });

  it("any other thrown value gets the generic popup and the raw message stays in details only", () => {
    const error = describeProblem(new Error("TypeError: undefined is not a function"));
    expect(error).toMatchObject({ code: "unexpected", title: "Algo deu errado", action: "retry" });
    expect(error.message).not.toMatch(/TypeError/);
    expect(error.details).toContain("undefined is not a function");
    expect(describeProblem("a string")).toMatchObject({ code: "unexpected" });
    expect(describeProblem(null).details).toContain("desconhecido");
  });
});

describe("catalog shape", () => {
  it("every entry has a title, a message and a known action", () => {
    for (const [code, text] of Object.entries(ERROR_CATALOG)) {
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.message.length).toBeGreaterThan(0);
      expect(text.action === "none" || text.action in ACTION_LABELS).toBe(true);
      expect(`${text.title} ${text.message}`).not.toMatch(/rascunho/i);
      expect(code).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("codeOfHeldMessage", () => {
  it("resolves the current and the legacy generic customer text to customer_unavailable", () => {
    expect(codeOfHeldMessage(CUSTOMER_UNAVAILABLE_MESSAGE)).toBe("customer_unavailable");
    expect(codeOfHeldMessage(LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE)).toBe("customer_unavailable");
  });

  it("resolves each stored customer cause and each product cause to its catalog key", () => {
    expect(codeOfHeldMessage(CUSTOMER_BLOCK_MESSAGES.customer_blocked)).toBe("customer_blocked");
    expect(codeOfHeldMessage(CUSTOMER_BLOCK_MESSAGES.customer_without_seller)).toBe("customer_without_seller");
    expect(codeOfHeldMessage(PRODUCT_BLOCK_MESSAGES.product_without_price)).toBe("product_without_price");
    expect(codeOfHeldMessage(PRODUCT_BLOCK_MESSAGES.product_inactive)).toBe("product_inactive");
  });

  it("returns null for null or a text that is not a held marker", () => {
    expect(codeOfHeldMessage(null)).toBeNull();
    expect(codeOfHeldMessage("Erro qualquer")).toBeNull();
  });
});

describe("problemForCode", () => {
  it("a known code gets its catalog text and the detail goes to details", () => {
    const problem = problemForCode("customer_inactive", "texto salvo");
    expect(problem).toMatchObject({ code: "customer_inactive", action: "change_customer" });
    expect(problem.details).toBe("Código: customer_inactive\nMensagem: texto salvo");
  });

  it("an unknown code gets the generic popup", () => {
    expect(problemForCode("nao_existe")).toMatchObject({ code: "unexpected", title: "Algo deu errado" });
  });
});
