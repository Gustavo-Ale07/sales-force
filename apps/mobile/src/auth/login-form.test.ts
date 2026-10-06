import { validateLoginForm } from "./login-form";

describe("validateLoginForm", () => {
  it("accepts a valid form and trims the username but never the password", () => {
    const result = validateLoginForm({ username: "  gustavo ", password: " senha com espaco " });
    expect(result).toEqual({ ok: true, value: { username: "gustavo", password: " senha com espaco " } });
    expect(result.ok && "email" in result.value).toBe(false);
  });

  it.each(["gustavo", "SAMUEL", "plac123", "usuario.teste"])("accepts the username %s without any e-mail format", (username) => {
    expect(validateLoginForm({ username, password: "x" })).toEqual({ ok: true, value: { username, password: "x" } });
  });

  it("requires both fields", () => {
    expect(validateLoginForm({ username: "", password: "" })).toEqual({
      ok: false,
      errors: { username: "Informe o usuário.", password: "Informe sua senha." },
    });
    expect(validateLoginForm({ username: "   ", password: "x" })).toEqual({
      ok: false,
      errors: { username: "Informe o usuário." },
    });
  });

  it("enforces the contract length limits", () => {
    expect(validateLoginForm({ username: "a".repeat(255), password: "x" })).toEqual({
      ok: false,
      errors: { username: "O usuário é longo demais." },
    });
    expect(validateLoginForm({ username: "gustavo", password: "x".repeat(257) })).toEqual({
      ok: false,
      errors: { password: "A senha é longa demais." },
    });
  });
});
