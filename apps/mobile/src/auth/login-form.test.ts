import { validateLoginForm } from "./login-form";

describe("validateLoginForm", () => {
  it("accepts a valid form and trims the e-mail but never the password", () => {
    expect(validateLoginForm({ email: "  ana@plac.com.br ", password: " senha com espaco " })).toEqual({
      ok: true,
      value: { email: "ana@plac.com.br", password: " senha com espaco " },
    });
  });

  it("requires both fields", () => {
    expect(validateLoginForm({ email: "", password: "" })).toEqual({
      ok: false,
      errors: { email: "Informe seu e-mail.", password: "Informe sua senha." },
    });
  });

  it("rejects a malformed e-mail with a pt-BR message", () => {
    expect(validateLoginForm({ email: "ana@", password: "x" })).toEqual({
      ok: false,
      errors: { email: "Informe um e-mail válido." },
    });
  });

  it("enforces the contract length limits", () => {
    const longEmail = `${"a".repeat(250)}@x.com`;
    expect(validateLoginForm({ email: longEmail, password: "x" })).toEqual({
      ok: false,
      errors: { email: "O e-mail é longo demais." },
    });
    expect(validateLoginForm({ email: "ana@plac.com.br", password: "x".repeat(257) })).toEqual({
      ok: false,
      errors: { password: "A senha é longa demais." },
    });
  });
});
