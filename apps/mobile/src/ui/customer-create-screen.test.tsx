import { fireEvent, render, screen } from "@testing-library/react-native";
import { CustomerCreateScreen } from "./customer-create-screen";

const CNPJ = "11.222.333/0001-81";

async function setup(onSave = jest.fn(async () => undefined)) {
  const onClose = jest.fn();
  await render(<CustomerCreateScreen onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

describe("CustomerCreateScreen", () => {
  it("shows the title and refuses an invalid document without saving", async () => {
    const { onSave } = await setup();
    expect(await screen.findByText("Novo cliente")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("CPF/CNPJ"), "111.111.111-11");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("CPF ou CNPJ inválido.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a company needs the state registration or Isento", async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), CNPJ);
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText('Informe a inscrição estadual ou marque "Isento".')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("an individual cannot have a state registration", async () => {
    await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.changeText(screen.getByLabelText("Inscrição estadual"), "123");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Pessoa física não tem inscrição estadual.")).toBeTruthy();
  });

  it("saves a strict request (ICMS R by default, Isento as ISENTO, no addresses) and shows Salvo", async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), CNPJ);
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Salvo")).toBeTruthy();
    expect(onSave).toHaveBeenCalledWith({
      document: "11222333000181",
      name: "Padaria",
      tradeName: null,
      icmsClassification: "R",
      stateRegistration: "ISENTO",
      phone: null,
      email: null,
      notes: null,
      addresses: [],
    });
  });

  it("the chosen ICMS class is sent", async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("ICMS C"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await screen.findByText("Salvo");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icmsClassification: "C", stateRegistration: null }));
  });

  it("a local refusal (duplicate waiting on the device) is shown and the form stays", async () => {
    const error = new Error("Já existe um cadastro com este CPF/CNPJ aguardando o Sankhya neste aparelho.");
    error.name = "PendingCustomerError";
    await setup(jest.fn(async () => Promise.reject(error)));
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText(error.message)).toBeTruthy();
    expect(screen.getByLabelText("Cadastrar")).toBeTruthy();
  });

  it("Cancelar closes without saving", async () => {
    const { onSave, onClose } = await setup();
    await fireEvent.press(await screen.findByLabelText("Cancelar"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
