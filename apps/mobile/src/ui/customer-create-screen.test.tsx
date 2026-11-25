import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CustomerRejectedError } from "../offline/pending-customers";
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

  it("an individual has no state registration field nor Isento, and no error about it", async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), CNPJ);
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.changeText(screen.getByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    expect(screen.queryByLabelText("Inscrição estadual")).toBeNull();
    expect(screen.queryByLabelText("Isento")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.queryByText(/Pessoa física não tem/)).toBeNull();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stateRegistration: null }));
  });

  it("with Isento checked on a company there is no state registration error", async () => {
    await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), CNPJ);
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(screen.queryByText(/Pessoa física não tem/)).toBeNull();
  });

  it("saves a strict request (ICMS R by default, Isento as ISENTO, no addresses)", async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), CNPJ);
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
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

  const ICMS = [
    { code: "C" as const, label: "Consumidor final" },
    { code: "R" as const, label: "Revendedor" },
  ];

  it("lists the ICMS classifications by NAME, Revendedor selected by default, and sends the chosen one", async () => {
    const onSave = jest.fn(async () => undefined);
    await render(<CustomerCreateScreen onSave={onSave} onClose={jest.fn()} icmsOptions={ICMS} />);
    expect(screen.getByLabelText("Classificação Revendedor").props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText("C")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Classificação Consumidor final"));
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icmsClassification: "C", stateRegistration: null }));
  });

  it("without the server's list the selector is not shown and the default R is sent", async () => {
    const { onSave } = await setup();
    expect(screen.queryByText("Classificação ICMS *")).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icmsClassification: "R" }));
  });

  it("a seller has no seller field; a non-seller must pick one and it is sent", async () => {
    const onSave = jest.fn(async () => undefined);
    await render(<CustomerCreateScreen onSave={onSave} onClose={jest.fn()} sellers={[{ code: 7, name: "Ana" }, { code: 9, name: "Beto" }]} />);
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Escolha o vendedor.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Vendedor Beto"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sellerCode: 9 }));
  });

  it("no seller field for a seller", async () => {
    await setup();
    expect(screen.queryByText("Vendedor *")).toBeNull();
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

  it("the button loads while the server creates the customer, and a second press does nothing", async () => {
    let release: () => void = () => undefined;
    const onSave = jest.fn(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    await setup(onSave);
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Cadastrando...")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cadastrando..."));
    expect(onSave).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByText("Cadastrar")).toBeTruthy();
  });

  it("a 422 shows the server's text on the field, saves nothing and keeps the form", async () => {
    const refusal = new CustomerRejectedError("Recusado", { document: "Este CPF/CNPJ já está cadastrado." });
    await setup(jest.fn(async () => Promise.reject(refusal)));
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Este CPF/CNPJ já está cadastrado.")).toBeTruthy();
    expect(screen.getByLabelText("CPF/CNPJ").props.value).toBe("529.982.247-25");
    // Editing the field clears the server's text for it.
    await fireEvent.changeText(screen.getByLabelText("CPF/CNPJ"), "111.444.777-35");
    expect(screen.queryByText("Este CPF/CNPJ já está cadastrado.")).toBeNull();
  });

  it("a 422 on the seller shows on the seller field", async () => {
    const refusal = new CustomerRejectedError("Recusado", { sellerCode: "Escolha o vendedor." });
    const onSave = jest.fn(async () => Promise.reject(refusal));
    await render(<CustomerCreateScreen onSave={onSave} onClose={jest.fn()} sellers={[{ code: 7, name: "Ana" }]} />);
    await fireEvent.changeText(await screen.findByLabelText("CPF/CNPJ"), "529.982.247-25");
    await fireEvent.changeText(screen.getByLabelText("Razão social ou nome"), "Maria");
    await fireEvent.press(screen.getByLabelText("Vendedor Ana"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Escolha o vendedor.")).toBeTruthy();
  });

  it("Cancelar closes without saving", async () => {
    const { onSave, onClose } = await setup();
    await fireEvent.press(await screen.findByLabelText("Cancelar"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
