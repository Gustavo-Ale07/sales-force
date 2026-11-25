import { fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerRegistration } from "../data/customer-write";
import { CustomerCreateScreen } from "./customer-create-screen";
import { CustomerRegistrationsSection } from "./customer-registrations-section";

const registration = (over: Partial<CustomerRegistration>): CustomerRegistration => ({
  registrationId: "0190a000-0000-7000-8000-0000000000aa",
  state: "awaiting_send",
  stateLabel: "Aguardando envio",
  customerCode: null,
  document: "11222333000181",
  name: "Alfa Ltda",
  reasonMessage: null,
  createdAt: "2026-11-25T12:00:00.000Z",
  ...over,
});

describe("CustomerRegistrationsSection", () => {
  it("lists the registrations with the server state text", async () => {
    const writer = { registrations: jest.fn(async () => [registration({}), registration({ registrationId: "b", state: "sent" as const, stateLabel: "Enviado ao Sankhya", customerCode: 2002, name: "Beta SA" })]) };
    await render(<CustomerRegistrationsSection writer={writer} onCorrect={jest.fn()} />);
    expect(await screen.findByText("Aguardando envio")).toBeTruthy();
    expect(screen.getByText("Enviado ao Sankhya")).toBeTruthy();
  });

  it("empty and error states", async () => {
    const failing = jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce([]);
    await render(<CustomerRegistrationsSection writer={{ registrations: failing }} onCorrect={jest.fn()} />);
    expect(await screen.findByText("Não foi possível carregar os cadastros.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Tentar de novo"));
    expect(await screen.findByText("Nenhum cadastro feito pelo Force")).toBeTruthy();
  });

  it("Precisa de correção shows the reason and opens the correction", async () => {
    const refused = registration({ state: "needs_correction", stateLabel: "Precisa de correção", reasonMessage: "O Sankhya recusou o cadastro." });
    const onCorrect = jest.fn();
    await render(<CustomerRegistrationsSection writer={{ registrations: async () => [refused] }} onCorrect={onCorrect} />);
    expect(await screen.findByText("O Sankhya recusou o cadastro.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Corrigir cadastro de Alfa Ltda"));
    expect(onCorrect).toHaveBeenCalledWith(refused);
  });
});

describe("CustomerCreateScreen as a correction", () => {
  it("opens filled in and sends correctsRegistrationId", async () => {
    const onSave = jest.fn(async () => undefined);
    const refused = registration({ state: "needs_correction", stateLabel: "Precisa de correção", reasonMessage: "O Sankhya recusou o cadastro." });
    await render(<CustomerCreateScreen onSave={onSave} onClose={jest.fn()} correction={refused} />);
    expect(await screen.findByText("Corrigir cadastro")).toBeTruthy();
    expect(screen.getByText("O Sankhya recusou o cadastro.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Isento"));
    await fireEvent.press(screen.getByLabelText("Cadastrar"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ document: "11222333000181", name: "Alfa Ltda", correctsRegistrationId: refused.registrationId }));
  });
});
