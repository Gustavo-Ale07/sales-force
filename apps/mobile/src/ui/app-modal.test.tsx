import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, StyleSheet, Text } from "react-native";
import { colors } from "../theme";
import { AppModalProvider, useAppModal, type AppModalApi } from "./app-modal";

const holder = { api: null as unknown as AppModalApi };
function Capture() {
  const value = useAppModal();
  useEffect(() => {
    holder.api = value;
  }, [value]);
  return <Text>conteúdo</Text>;
}

async function mount(copyText?: (text: string) => void) {
  await render(
    <AppModalProvider copyText={copyText}>
      <Capture />
    </AppModalProvider>,
  );
}

const dialog = () => screen.getByTestId("app-modal");
/** Android hardware Back: the Modal's `onRequestClose`, found on the host Modal above the dialog. */
function pressHardwareBack() {
  let node = dialog().parent;
  while (node !== null && node !== undefined && typeof node.props.onRequestClose !== "function") node = node.parent;
  if (node === null || node === undefined) throw new Error("no Modal with onRequestClose above the dialog");
  node.props.onRequestClose();
}
const pressButton =(label: string) => fireEvent.press(within(dialog()).getByRole("button", { name: label }));

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useAppModal", () => {
  it("throws outside the provider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Capture />)).rejects.toThrow(/AppModalProvider/);
    spy.mockRestore();
  });
});

describe("confirm", () => {
  it("resolves true on the confirm button and closes the dialog", async () => {
    await mount();
    let result: boolean | undefined;
    await act(async () => {
      void holder.api.confirm({ title: "Excluir?", message: "Não pode ser desfeito.", confirmLabel: "Excluir" }).then((value) => (result = value));
    });
    expect(screen.getByText("Excluir?")).toBeTruthy();
    expect(screen.getByText("Não pode ser desfeito.")).toBeTruthy();
    await pressButton("Excluir");
    await waitFor(() => expect(result).toBe(true));
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("resolves false on cancel", async () => {
    await mount();
    let result: boolean | undefined;
    await act(async () => {
      void holder.api.confirm({ title: "Sair?" }).then((value) => (result = value));
    });
    expect(within(dialog()).getByRole("button", { name: "Confirmar" })).toBeTruthy(); // default labels
    await pressButton("Cancelar");
    await waitFor(() => expect(result).toBe(false));
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("hardware Back (onRequestClose) is a cancel: resolves false", async () => {
    await mount();
    let result: boolean | undefined;
    await act(async () => {
      void holder.api.confirm({ title: "Sair?" }).then((value) => (result = value));
    });
    await act(async () => {
      pressHardwareBack();
    });
    await waitFor(() => expect(result).toBe(false));
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("hardware Back on an info dialog just closes it", async () => {
    await mount();
    await act(async () => {
      holder.api.inform("Aviso", "Texto");
    });
    expect(within(dialog()).getByRole("button", { name: "Entendi" })).toBeTruthy();
    await act(async () => {
      pressHardwareBack();
    });
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("destructive: the confirm button is red, the cancel button is an outline; the default is navy", async () => {
    await mount();
    await act(async () => {
      void holder.api.confirm({ title: "Excluir?", confirmLabel: "Excluir", destructive: true });
    });
    const confirmStyle = StyleSheet.flatten(within(dialog()).getByRole("button", { name: "Excluir" }).props.style);
    expect(confirmStyle.backgroundColor).toBe(colors.red);
    const cancelStyle = StyleSheet.flatten(within(dialog()).getByRole("button", { name: "Cancelar" }).props.style);
    expect(cancelStyle.backgroundColor).toBe(colors.surface);
    expect(cancelStyle.borderWidth).toBe(1);
    await pressButton("Cancelar");

    await act(async () => {
      void holder.api.confirm({ title: "Salvar?", confirmLabel: "Salvar" });
    });
    const primary = StyleSheet.flatten(within(dialog()).getByRole("button", { name: "Salvar" }).props.style);
    expect(primary.backgroundColor).toBe(colors.navy);
  });

  it("lists the primary action first and cancel last", async () => {
    await mount();
    await act(async () => {
      holder.api.show({
        title: "Escolha",
        buttons: [
          { label: "Voltar", role: "cancel" },
          { label: "Outra", role: "secondary" },
          { label: "Fazer", role: "primary" },
        ],
      });
    });
    const labels = within(dialog()).getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(labels).toEqual(["Fazer", "Outra", "Voltar"]);
  });
});

describe("queue", () => {
  it("shows one dialog at a time: the second waits for the first to close, in order", async () => {
    await mount();
    await act(async () => {
      holder.api.inform("Primeiro", "um");
      holder.api.inform("Segundo", "dois");
    });
    expect(screen.getAllByTestId("app-modal")).toHaveLength(1);
    expect(screen.getByText("Primeiro")).toBeTruthy();
    expect(screen.queryByText("Segundo")).toBeNull();
    await pressButton("Entendi");
    expect(await screen.findByText("Segundo")).toBeTruthy();
    expect(screen.queryByText("Primeiro")).toBeNull();
    await pressButton("Entendi");
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });

  it("a button's own action runs once, after the dialog closes", async () => {
    await mount();
    const onPress = jest.fn();
    await act(async () => {
      holder.api.show({ title: "Ação", buttons: [{ label: "Ir", role: "primary", onPress }] });
    });
    await pressButton("Ir");
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });
});

describe("details", () => {
  it("hides the technical text until 'Ver detalhes' is pressed, and toggles it back", async () => {
    await mount();
    await act(async () => {
      holder.api.show({ variant: "error", title: "Erro", message: "Algo falhou.", details: "Código: x\nStatus: 500" });
    });
    expect(screen.queryByTestId("app-modal-details")).toBeNull();
    await fireEvent.press(within(dialog()).getByText("Ver detalhes"));
    expect(screen.getByTestId("app-modal-details").props.selectable).toBe(true);
    expect(screen.getByText(/Status: 500/)).toBeTruthy();
    await fireEvent.press(within(dialog()).getByText("Ocultar"));
    expect(screen.queryByTestId("app-modal-details")).toBeNull();
  });

  it("offers no toggle without details, and no 'Copiar' without a clipboard function", async () => {
    await mount();
    await act(async () => {
      holder.api.show({ title: "Sem detalhes" });
    });
    expect(screen.queryByText("Ver detalhes")).toBeNull();
    await pressButton("Entendi");
    await act(async () => {
      holder.api.show({ title: "Com detalhes", details: "abc" });
    });
    await fireEvent.press(screen.getByText("Ver detalhes"));
    expect(screen.queryByText("Copiar")).toBeNull();
  });

  it("copies the details when a clipboard function is wired", async () => {
    const copyText = jest.fn();
    await mount(copyText);
    await act(async () => {
      holder.api.show({ title: "Erro", details: "Código: x" });
    });
    await fireEvent.press(screen.getByText("Ver detalhes"));
    await fireEvent.press(screen.getByText("Copiar"));
    expect(copyText).toHaveBeenCalledWith("Código: x");
    expect(screen.getByText("Copiado")).toBeTruthy();
  });
});

describe("motion", () => {
  it("under reduced motion the dialog just appears: no timing animation, full opacity at once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const timing = jest.spyOn(Animated, "timing");
    await mount();
    await act(async () => {
      holder.api.inform("Aviso");
    });
    await waitFor(() => expect(StyleSheet.flatten(dialog().parent?.props.style).opacity).toBe(1));
    expect(timing).not.toHaveBeenCalled();
  });

  it("with motion allowed the dialog fades and scales in (timing animation runs)", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const timing = jest.spyOn(Animated, "timing");
    await mount();
    await act(async () => {
      holder.api.inform("Aviso");
    });
    await waitFor(() => expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 180 })));
  });
});
