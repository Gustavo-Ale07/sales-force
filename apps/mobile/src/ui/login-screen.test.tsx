import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { LoginResult } from "../auth/auth-port";
import { account, fakeAuth } from "../test-doubles";
import { LoginScreen, describeLoginFailure } from "./login-screen";

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("E-mail"), email);
  await fireEvent.changeText(screen.getByLabelText("Senha"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Entrar" }));
}

describe("LoginScreen", () => {
  it("blocks the request and shows field errors when the form is invalid", async () => {
    const login = jest.fn();
    await render(<LoginScreen auth={fakeAuth({ login })} onAuthenticated={jest.fn()} />);
    await fillAndSubmit("", "");
    expect(login).not.toHaveBeenCalled();
    expect(screen.getAllByText(/obrigat|inv[áa]lid|informe/i).length).toBeGreaterThan(0);
  });

  it("signs in with trimmed e-mail and untouched password, then reports the account", async () => {
    const login = jest.fn(async (): Promise<LoginResult> => ({ ok: true, account }));
    const onAuthenticated = jest.fn();
    await render(<LoginScreen auth={fakeAuth({ login })} onAuthenticated={onAuthenticated} />);
    await fillAndSubmit("  ana@plac.com.br ", " senha com espaco ");
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(account));
    expect(login).toHaveBeenCalledWith({ email: "ana@plac.com.br", password: " senha com espaco " });
  });

  it("shows the server outcome for wrong credentials and stays on the form", async () => {
    const onAuthenticated = jest.fn();
    const auth = fakeAuth({ login: async () => ({ ok: false, reason: "invalid_credentials" }) });
    await render(<LoginScreen auth={auth} onAuthenticated={onAuthenticated} />);
    await fillAndSubmit("ana@plac.com.br", "errada");
    expect(await screen.findByText("E-mail ou senha inválidos.")).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("shows a generic message when the call throws (offline)", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new Error("boom");
      },
    });
    await render(<LoginScreen auth={auth} onAuthenticated={jest.fn()} />);
    await fillAndSubmit("ana@plac.com.br", "segredo");
    expect(await screen.findByText(describeLoginFailure({ ok: false, reason: "unavailable" }))).toBeTruthy();
  });
});

describe("describeLoginFailure", () => {
  it("includes the retry delay when the server sent one", () => {
    expect(describeLoginFailure({ ok: false, reason: "rate_limited", retryAfterSeconds: 45 })).toContain("45 segundos");
    expect(describeLoginFailure({ ok: false, reason: "rate_limited" })).toContain("Aguarde");
  });
});
