import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { LoginResult } from "../auth/auth-port";
import { account, fakeAuth } from "../test-doubles";
import { LoginScreen, describeLoginFailure } from "./login-screen";

async function fillAndSubmit(username: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("Usuário"), username);
  await fireEvent.changeText(screen.getByLabelText("Senha"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Entrar" }));
}

describe("LoginScreen", () => {
  it("blocks the request and shows field errors when the form is invalid", async () => {
    const login = jest.fn();
    await render(<LoginScreen auth={fakeAuth({ login })} onAuthenticated={jest.fn()} />);
    await fillAndSubmit("", "");
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByText("Informe o usuário.")).toBeTruthy();
  });

  it("uses a username field without e-mail keyboard hints", async () => {
    await render(<LoginScreen auth={fakeAuth()} onAuthenticated={jest.fn()} />);
    const field = screen.getByLabelText("Usuário");
    expect(field.props.placeholder).toBe("Digite seu usuário");
    expect(field.props.keyboardType).not.toBe("email-address");
    expect(field.props.textContentType).toBe("username");
    expect(field.props.autoComplete).toBe("username");
    expect(screen.queryByLabelText("E-mail")).toBeNull();
  });

  it("signs in with trimmed username and untouched password, then reports the account", async () => {
    const login = jest.fn(async (): Promise<LoginResult> => ({ ok: true, account }));
    const onAuthenticated = jest.fn();
    await render(<LoginScreen auth={fakeAuth({ login })} onAuthenticated={onAuthenticated} />);
    await fillAndSubmit("  usuario.teste ", " senha com espaco ");
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(account));
    expect(login).toHaveBeenCalledWith({ username: "usuario.teste", password: " senha com espaco " });
  });

  it("shows the server outcome for wrong credentials and stays on the form", async () => {
    const onAuthenticated = jest.fn();
    const auth = fakeAuth({ login: async () => ({ ok: false, reason: "invalid_credentials" }) });
    await render(<LoginScreen auth={auth} onAuthenticated={onAuthenticated} />);
    await fillAndSubmit("SAMUEL", "errada");
    expect(await screen.findByText("Usuário ou senha inválidos.")).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("shows a generic message when the call throws (offline)", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new Error("boom");
      },
    });
    await render(<LoginScreen auth={auth} onAuthenticated={jest.fn()} />);
    await fillAndSubmit("gustavo", "segredo");
    expect(
      await screen.findByText("Não foi possível realizar a autenticação no momento. Tente novamente."),
    ).toBeTruthy();
  });
});

describe("LoginScreen identity and password", () => {
  it("shows Force with the app version, and lets the seller reveal the password", async () => {
    await render(<LoginScreen auth={fakeAuth()} onAuthenticated={jest.fn()} />);
    expect(screen.getByText("Force")).toBeTruthy();
    expect(screen.getByText(/^Force · v[0-9]/)).toBeTruthy();
    expect(screen.queryByText(/Servidor/)).toBeNull();
    expect(screen.getByLabelText("Senha").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(screen.getByLabelText("Senha").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toBeTruthy();
  });

  it("explains that signing in needs a connection when the device is offline", async () => {
    await render(<LoginScreen auth={fakeAuth()} onAuthenticated={jest.fn()} connectivity="offline" />);
    expect(screen.getByText(/Conecte-se à internet para entrar/)).toBeTruthy();
  });
});

describe("describeLoginFailure", () => {
  it("uses the generic credential and unavailable copy, revealing nothing about the account", () => {
    expect(describeLoginFailure({ ok: false, reason: "invalid_credentials" })).toBe("Usuário ou senha inválidos.");
    expect(describeLoginFailure({ ok: false, reason: "unavailable" })).toBe(
      "Não foi possível realizar a autenticação no momento. Tente novamente.",
    );
  });

  it("includes the retry delay when the server sent one", () => {
    expect(describeLoginFailure({ ok: false, reason: "rate_limited", retryAfterSeconds: 45 })).toContain("45 segundos");
    expect(describeLoginFailure({ ok: false, reason: "rate_limited" })).toContain("Aguarde");
  });
});
