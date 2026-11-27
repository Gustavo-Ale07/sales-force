import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AddServerScreen } from "./add-server-screen";

describe("AddServerScreen", () => {
  it("shows only the field and the button, no login", async () => {
    await render(<AddServerScreen onSubmit={async () => true} />);
    expect(screen.getByText("Adicionar servidor")).toBeTruthy();
    expect(screen.getByLabelText("Código")).toBeTruthy();
    expect(screen.queryByLabelText("Usuário")).toBeNull();
    expect(screen.queryByText("Código inválido")).toBeNull();
  });

  it("a refused code shows only Código inválido", async () => {
    const onSubmit = jest.fn(async () => false);
    await render(<AddServerScreen onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByLabelText("Código"), "sf1.xxx");
    await fireEvent.press(screen.getByLabelText("Adicionar"));
    expect(await screen.findByText("Código inválido")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith("sf1.xxx");
  });

  it("an accepted code shows no message", async () => {
    const onSubmit = jest.fn(async () => true);
    await render(<AddServerScreen onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByLabelText("Código"), "sf1.ok");
    await fireEvent.press(screen.getByLabelText("Adicionar"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText("Código inválido")).toBeNull();
  });
});
