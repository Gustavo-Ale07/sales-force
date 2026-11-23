import { useEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { Text } from "react-native";
import { ApiRequestError } from "../data/api";
import { AppModalProvider } from "./app-modal";
import { ErrorActionsContext, useErrorPopup, type ErrorPopupApi, type ProblemHandlers } from "./use-error-popup";

const holder = { popup: null as unknown as ErrorPopupApi };
function Capture() {
  const value = useErrorPopup();
  useEffect(() => {
    holder.popup = value;
  }, [value]);
  return <Text>tela</Text>;
}

async function mount(shared?: ProblemHandlers) {
  await render(
    <AppModalProvider>
      {shared === undefined ? (
        <Capture />
      ) : (
        <ErrorActionsContext.Provider value={shared}>
          <Capture />
        </ErrorActionsContext.Provider>
      )}
    </AppModalProvider>,
  );
}

const dialog = () => screen.getByTestId("app-modal");
const labels = () =>
  within(dialog())
    .getAllByRole("button")
    .map((button) => button.props.accessibilityLabel)
    .filter((label) => label !== undefined);

describe("useErrorPopup", () => {
  it("shows title and message from the catalog and keeps the technical text behind 'Ver detalhes'", async () => {
    await mount();
    await act(async () => {
      holder.popup.report(new ApiRequestError({ status: 500, message: "stack trace here" }));
    });
    expect(screen.getByText("Erro no servidor")).toBeTruthy();
    expect(screen.queryByText(/stack trace here/)).toBeNull();
    await fireEvent.press(screen.getByText("Ver detalhes"));
    expect(screen.getByText(/stack trace here/)).toBeTruthy();
  });

  it("offers the action button only when the screen gives a handler; otherwise only 'Fechar'", async () => {
    await mount();
    await act(async () => {
      holder.popup.report(new ApiRequestError({ status: 0, message: "x" })); // action: retry
    });
    expect(labels()).toEqual(["Fechar"]);
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Fechar" }));

    const retry = jest.fn();
    await act(async () => {
      holder.popup.report(new ApiRequestError({ status: 0, message: "x" }), { retry });
    });
    expect(labels()).toEqual(["Tentar de novo", "Fechar"]);
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("a problem whose action is 'none' never shows an action button, even with handlers", async () => {
    await mount();
    await act(async () => {
      holder.popup.reportCode("forbidden", { retry: jest.fn(), go_sync: jest.fn() });
    });
    expect(labels()).toEqual(["Fechar"]);
  });

  it("a handler for a different action is not offered", async () => {
    await mount();
    await act(async () => {
      holder.popup.reportCode("offline", { go_sync: jest.fn() }); // offline needs retry
    });
    expect(labels()).toEqual(["Fechar"]);
  });

  it("shell defaults: go_sync and sign_in come from the context", async () => {
    const go_sync = jest.fn();
    const sign_in = jest.fn();
    await mount({ go_sync, sign_in });

    await act(async () => {
      holder.popup.reportCode("dataset_changed");
    });
    expect(labels()).toEqual(["Ir para sincronização", "Fechar"]);
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Ir para sincronização" }));
    expect(go_sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      holder.popup.reportCode("unauthenticated");
    });
    expect(labels()).toEqual(["Entrar de novo", "Fechar"]);
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Entrar de novo" }));
    expect(sign_in).toHaveBeenCalledTimes(1);
  });

  it("a screen's own handler wins over the shell default", async () => {
    const shell = jest.fn();
    const own = jest.fn();
    await mount({ go_sync: shell });
    await act(async () => {
      holder.popup.reportCode("dataset_changed", { go_sync: own });
    });
    await fireEvent.press(within(dialog()).getByRole("button", { name: "Ir para sincronização" }));
    expect(own).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
  });

  it("an override changes title and message only; the code and the action stay the catalog's", async () => {
    await mount();
    let problem: ReturnType<ErrorPopupApi["reportCode"]> | undefined;
    await act(async () => {
      problem = holder.popup.reportCode("customer_unavailable", { change_customer: jest.fn() }, undefined, { title: "PDF não gerado", message: "Troque o cliente." });
    });
    expect(screen.getByText("PDF não gerado")).toBeTruthy();
    expect(screen.getByText("Troque o cliente.")).toBeTruthy();
    expect(problem).toMatchObject({ code: "customer_unavailable", action: "change_customer" });
    expect(labels()).toEqual(["Trocar cliente", "Fechar"]);
  });

  it("reportCode puts the stored detail text into details", async () => {
    await mount();
    await act(async () => {
      holder.popup.reportCode("sync_failed", undefined, "texto técnico guardado");
    });
    await fireEvent.press(screen.getByText("Ver detalhes"));
    expect(screen.getByTestId("app-modal-details").props.children).toContain("texto técnico guardado");
  });
});
