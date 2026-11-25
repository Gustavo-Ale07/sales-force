import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { CustomerWritePort } from "../data/customer-write";
import { CustomerEditScreen } from "./customer-edit-screen";

async function setup(update: CustomerWritePort["update"], extra: { connectivity?: "online" | "offline" } = {}) {
  let n = 0;
  const writer: CustomerWritePort = { update: jest.fn(update) };
  const onClose = jest.fn();
  const view = await render(<CustomerEditScreen customerName="Padaria Central" code={10} writer={writer} onClose={onClose} newId={() => `id-${++n}`} {...extra} />);
  return { writer, onClose, view };
}

const sent = async () => ({ state: "sent" as const, reasonMessage: null });

describe("CustomerEditScreen", () => {
  it("an empty form shows the shared text and sends nothing", async () => {
    const { writer } = await setup(sent);
    await fireEvent.press(await screen.findByLabelText("Salvar"));
    expect(await screen.findByText("Preencha ao menos um campo para alterar.")).toBeTruthy();
    expect(writer.update).not.toHaveBeenCalled();
  });

  it("sends a strict body with only the filled fields, phone as digits", async () => {
    const { writer } = await setup(sent);
    await fireEvent.changeText(await screen.findByLabelText("Telefone"), "(11) 98888-7777");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Enviado ao Sankhya")).toBeTruthy();
    expect(writer.update).toHaveBeenCalledWith(10, { clientRequestId: "id-1", phone: "11988887777" });
  });

  it("adds and removes contacts with numbered labels and requires the contact name", async () => {
    const { writer } = await setup(sent);
    await fireEvent.press(await screen.findByLabelText("Adicionar contato"));
    expect(screen.getByLabelText("Remover contato 1")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Informe o nome do contato.")).toBeTruthy();
    expect(writer.update).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Remover contato 1"));
    expect(screen.queryByLabelText("Remover contato 1")).toBeNull();
  });

  it("409 customer_edit_disabled shows the contract text and a new request id on the next try", async () => {
    const { writer } = await setup(async () => {
      throw new ApiRequestError({ status: 409, message: "x", reason: "customer_edit_disabled" });
    });
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("A edição de cliente não está liberada nesta instalação. Nada foi alterado.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Salvar"));
    await screen.findByText("A edição de cliente não está liberada nesta instalação. Nada foi alterado.");
    const ids = (writer.update as jest.Mock).mock.calls.map((call) => call[1].clientRequestId);
    expect(ids).toStrictEqual(["id-1", "id-2"]);
  });

  it("keeps the request id after a lost answer and changes it when the form changes", async () => {
    const { writer } = await setup(async () => {
      throw new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
    });
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    await screen.findByText("Sem conexão com o servidor. Nada foi alterado.");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    await screen.findByText("Sem conexão com o servidor. Nada foi alterado.");
    await fireEvent.changeText(screen.getByLabelText("Observações"), "ligar de manhã");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    await screen.findByText("Sem conexão com o servidor. Nada foi alterado.");
    const ids = (writer.update as jest.Mock).mock.calls.map((call) => call[1].clientRequestId);
    expect(ids).toStrictEqual(["id-1", "id-1", "id-2"]);
  });

  it("400 unrecognized_keys names the refused fields", async () => {
    await setup(async () => {
      throw new ApiRequestError({ status: 400, message: "x", issues: [{ path: "document", code: "unrecognized_keys" }] });
    });
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Estes campos não podem ser alterados: CPF/CNPJ.")).toBeTruthy();
  });

  it("Precisa de correção shows the server's reason", async () => {
    await setup(async () => ({ state: "needs_correction" as const, reasonMessage: "O Sankhya recusou o telefone." }));
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Precisa de correção")).toBeTruthy();
    expect(screen.getByText("O Sankhya recusou o telefone.")).toBeTruthy();
  });

  it("Aguardando envio is shown with its label", async () => {
    await setup(async () => ({ state: "awaiting_send" as const, reasonMessage: null }));
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Aguardando envio")).toBeTruthy();
  });

  it("offline sends nothing and says so", async () => {
    const { writer } = await setup(sent, { connectivity: "offline" });
    await fireEvent.changeText(await screen.findByLabelText("Observações"), "ligar");
    await fireEvent.press(screen.getByLabelText("Salvar"));
    expect(await screen.findByText("Sem conexão com o servidor. Nada foi alterado.")).toBeTruthy();
    expect(writer.update).not.toHaveBeenCalled();
  });
});
