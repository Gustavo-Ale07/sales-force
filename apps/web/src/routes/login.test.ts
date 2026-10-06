import { describe, expect, it } from "vitest";
import { validateLogin } from "./login";

describe("validateLogin", () => {
  it.each(["gustavo", "SAMUEL", "plac123", "usuario.teste"])("accepts the username %s without a format error", (username) => {
    expect(validateLogin(username, "segredo")).toEqual({});
  });

  it.each(["", "   ", "\t"])("asks for the username when empty after trim (%j)", (username) => {
    expect(validateLogin(username, "segredo")).toEqual({ username: "Informe o usuário." });
  });

  it("asks for the password when empty", () => {
    expect(validateLogin("gustavo", "")).toEqual({ password: "Informe a senha." });
  });

  it("reports both fields", () => {
    expect(validateLogin(" ", "")).toEqual({ username: "Informe o usuário.", password: "Informe a senha." });
  });
});
