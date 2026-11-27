import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { AddressPort } from "../offline/address-port";
import { CustomerRejectedError } from "../offline/pending-customers";
import { CustomerCreateScreen } from "./customer-create-screen";

const CNPJ = "11.222.333/0001-81";
const CPF = "529.982.247-25";

const CITIES = [
  { code: 3550308, name: "São Paulo", uf: "SP", ibge: "3550308" },
  { code: 3304557, name: "Rio de Janeiro", uf: "RJ", ibge: "3304557" },
];

function fakeAddresses(overrides: Partial<AddressPort> = {}): AddressPort {
  const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return {
    searchCities: async (query) => CITIES.filter((city) => fold(`${city.name} ${city.uf}`).includes(fold(query))),
    searchNeighborhoods: async (query) => [{ code: 5, name: "Centro" }].filter((item) => fold(item.name).includes(fold(query))),
    searchStreets: async (query) => [{ code: 9, name: "Paulista", kind: "Avenida" }].filter((item) => fold(item.name).includes(fold(query))),
    lookupPostalCode: async () => null,
    customerPriceTables: async () => ({ items: [{ code: 5, name: "Tabela Padrão" }, { code: 7, name: "Tabela Atacado" }], defaultCode: 5 }),
    ...overrides,
  };
}

async function setup(onSave = jest.fn(async () => undefined), extra: Partial<React.ComponentProps<typeof CustomerCreateScreen>> = {}) {
  const onClose = jest.fn();
  await render(<CustomerCreateScreen onSave={onSave} onClose={onClose} addresses={fakeAddresses()} {...extra} />);
  return { onSave, onClose };
}

/** Screen 1 as an individual (no state registration), then on to screen 2. */
async function identifyPerson(document = CPF, name = "Maria") {
  await fireEvent.press(await screen.findByLabelText("Pessoa Física"));
  await fireEvent.changeText(screen.getByLabelText("CPF"), document);
  await fireEvent.changeText(screen.getByLabelText("Nome"), name);
  await fireEvent.press(screen.getByLabelText("Continuar"));
}

async function chooseCity(label = "Cidade São Paulo - SP", query = "sao") {
  await fireEvent.changeText(await screen.findByLabelText("Pesquisar cidade"), query);
  await fireEvent.press(await screen.findByLabelText(label));
}

describe("CustomerCreateScreen", () => {
  it("shows the progress and, on screen 1, refuses an invalid document on the field", async () => {
    const { onSave } = await setup();
    expect(await screen.findByLabelText("Etapa 1 de 3: Identificação")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("CNPJ"), "111.111.111-11");
    await fireEvent.changeText(screen.getByLabelText("Razão social"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByText("CNPJ inválido.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 3: Identificação")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a company needs the state registration or Isento", async () => {
    await setup();
    await fireEvent.changeText(await screen.findByLabelText("CNPJ"), CNPJ);
    await fireEvent.changeText(screen.getByLabelText("Razão social"), "Padaria");
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByText('Informe a inscrição estadual ou marque "Isento".')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByLabelText("Etapa 2 de 3: Endereço e contato")).toBeTruthy();
  });

  it("an individual has no trade name, state registration or Isento", async () => {
    await setup();
    await fireEvent.press(await screen.findByLabelText("Pessoa Física"));
    expect(screen.queryByLabelText("Nome fantasia")).toBeNull();
    expect(screen.queryByLabelText("Inscrição estadual")).toBeNull();
    expect(screen.queryByLabelText("Isento")).toBeNull();
  });

  it("screen 2 requires only the city, shown on the field", async () => {
    await setup();
    await identifyPerson();
    await fireEvent.press(await screen.findByLabelText("Continuar"));
    expect(await screen.findByText("Escolha a cidade.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 2 de 3: Endereço e contato")).toBeTruthy();
  });

  it("the city search ignores accents and case and shows Nome - UF", async () => {
    await setup();
    await identifyPerson();
    await fireEvent.changeText(await screen.findByLabelText("Pesquisar cidade"), "SAO PAULO");
    expect(await screen.findByLabelText("Cidade São Paulo - SP")).toBeTruthy();
    expect(screen.queryByLabelText("Cidade Rio de Janeiro - RJ")).toBeNull();
  });

  it("Voltar goes back one screen keeping what was typed; on the first it leaves", async () => {
    const { onClose } = await setup();
    await identifyPerson();
    await fireEvent.press(await screen.findByLabelText("Voltar"));
    expect((await screen.findByLabelText("Nome")).props.value).toBe("Maria");
    await fireEvent.press(screen.getByLabelText("Voltar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("registers with the address of screen 2 (city, free text and a picked suggestion) and an automatic seller", async () => {
    const { onSave } = await setup();
    await identifyPerson();
    await chooseCity();
    await fireEvent(screen.getByLabelText("Rua"), "focus");
    await fireEvent.changeText(screen.getByLabelText("Rua"), "Pauli");
    await fireEvent.press(await screen.findByLabelText("Rua Avenida Paulista"));
    await fireEvent.changeText(screen.getByLabelText("Bairro"), "Vila Nova");
    await fireEvent.changeText(screen.getByLabelText("Número"), "10");
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByLabelText("Etapa 3 de 3: Comercial")).toBeTruthy();
    expect(screen.getByLabelText("Vendedor").props.editable).toBe(false);
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({
      document: "52998224725",
      name: "Maria",
      tradeName: null,
      icmsClassification: "R",
      stateRegistration: null,
      phone: null,
      email: null,
      notes: null,
      addresses: [{ cityCode: 3550308, streetCode: 9, streetName: null, neighborhoodCode: 0, neighborhoodName: "Vila Nova", number: "10", complement: null, postalCode: null }],
      priceTableCode: 5,
    });
  });

  it("a complete CEP fills street, neighborhood and city, all still editable", async () => {
    const lookupPostalCode = jest.fn(async () => ({ found: true as const, postalCode: "01310100", street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", uf: "SP", cityCode: 3550308, neighborhoodCode: 0, streetCode: 0, source: "viacep" }));
    await setup(undefined, { addresses: fakeAddresses({ lookupPostalCode }) });
    await identifyPerson();
    await fireEvent.changeText(await screen.findByLabelText("CEP"), "01310-100");
    await waitFor(() => expect(screen.getByLabelText("Rua").props.value).toBe("Avenida Paulista"));
    expect(lookupPostalCode).toHaveBeenCalledWith("01310100");
    expect(screen.getByLabelText("Bairro").props.value).toBe("Bela Vista");
    expect(screen.getByLabelText("Cidade escolhida: São Paulo - SP")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Rua"), "Avenida Paulista, lado par");
    expect(screen.getByLabelText("Rua").props.value).toBe("Avenida Paulista, lado par");
  });

  it("offline or CEP not found: no text, no error, the city is still required", async () => {
    await setup();
    await identifyPerson();
    await fireEvent.changeText(await screen.findByLabelText("CEP"), "01310-100");
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByText("Escolha a cidade.")).toBeTruthy();
    expect(screen.queryByText(/CEP não/)).toBeNull();
  });

  it("lists the ICMS classifications by NAME, Revendedor by default, and sends the chosen one", async () => {
    const onSave = jest.fn(async () => undefined);
    const icms = [
      { code: "C" as const, label: "Consumidor final" },
      { code: "R" as const, label: "Revendedor" },
    ];
    await setup(onSave, { icmsOptions: icms });
    expect(screen.getByLabelText("Classificação Revendedor").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByLabelText("Classificação Consumidor final"));
    await identifyPerson();
    await chooseCity();
    await fireEvent.press(screen.getByLabelText("Continuar"));
    await fireEvent.press(await screen.findByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icmsClassification: "C" }));
  });

  it("the price table starts as the installation default and the chosen one is sent", async () => {
    const onSave = jest.fn(async () => undefined);
    await setup(onSave);
    await identifyPerson();
    await chooseCity();
    await fireEvent.press(screen.getByLabelText("Continuar"));
    expect(await screen.findByLabelText("Tabela de preço Tabela Atacado")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Tabela de preço Tabela Atacado"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ priceTableCode: 7 })));
  });

  it("a non-seller must pick the seller on screen 3, and it is sent", async () => {
    const onSave = jest.fn(async () => undefined);
    await setup(onSave, { sellers: [{ code: 7, name: "Ana" }, { code: 9, name: "Beto" }] });
    await identifyPerson();
    await chooseCity();
    await fireEvent.press(screen.getByLabelText("Continuar"));
    await fireEvent.press(await screen.findByLabelText("Cadastrar"));
    expect(await screen.findByText("Escolha o vendedor.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Vendedor Beto"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sellerCode: 9 }));
  });

  async function reachLastScreen() {
    await identifyPerson();
    await chooseCity();
    await fireEvent.press(screen.getByLabelText("Continuar"));
    await screen.findByLabelText("Etapa 3 de 3: Comercial");
  }

  it("a local refusal (duplicate waiting on the device) is shown and the form stays", async () => {
    const error = new Error("Já existe um cadastro com este CPF/CNPJ aguardando o Sankhya neste aparelho.");
    error.name = "PendingCustomerError";
    await setup(jest.fn(async () => Promise.reject(error)));
    await reachLastScreen();
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText(error.message)).toBeTruthy();
    expect(screen.getByLabelText("Cadastrar")).toBeTruthy();
  });

  it("the button loads while the server creates the customer, and a second press does nothing", async () => {
    let release: () => void = () => undefined;
    const onSave = jest.fn(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    await setup(onSave);
    await reachLastScreen();
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByLabelText("Cadastrando...")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cadastrando..."));
    expect(onSave).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByLabelText("Cadastrar")).toBeTruthy();
  });

  it("a refusal on the document takes the seller to screen 1 with the server's text on the field", async () => {
    const refusal = new CustomerRejectedError("Recusado", { document: "Este CPF/CNPJ já está cadastrado." });
    await setup(jest.fn(async () => Promise.reject(refusal)));
    await reachLastScreen();
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Este CPF/CNPJ já está cadastrado.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 3: Identificação")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("CPF"), "111.444.777-35");
    expect(screen.queryByText("Este CPF/CNPJ já está cadastrado.")).toBeNull();
  });

  it("a refusal on the city shows on the city field of screen 2", async () => {
    const refusal = new CustomerRejectedError("Recusado", { cityCode: "Informe a cidade." });
    await setup(jest.fn(async () => Promise.reject(refusal)));
    await reachLastScreen();
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(await screen.findByText("Informe a cidade.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 2 de 3: Endereço e contato")).toBeTruthy();
  });

  it("the exit control closes without saving", async () => {
    const { onSave, onClose } = await setup();
    await fireEvent.press(await screen.findByLabelText("Sair do cadastro"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
