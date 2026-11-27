import { describe, expect, it } from "vitest";
import { buildOrderHtml } from "./order-print";
import { orderDetail } from "../test/fixtures";

const REGISTRY = {
  postalCode: "01310100", street: "Rua Registro Teste", number: "10", complement: null, neighborhood: "Bairro Teste", city: "Cidade Teste", state: "SP",
  mobile: null, phone: null, email: "cadastro@exemplo.test",
};

describe("pedido impresso: cadastro do cliente (espelho do Sankhya)", () => {
  it("imprime o endereço e o e-mail do cadastro e a transportadora padrão do cliente", () => {
    const html = buildOrderHtml(orderDetail({ carrierCode: null }), "http://localhost", { customerRegistry: REGISTRY, carrierName: null, customerDefaultCarrierName: "Transportadora Padrao Teste" });
    expect(html).toContain("Rua Registro Teste");
    expect(html).toContain("01310-100");
    expect(html).toContain("cadastro@exemplo.test");
    expect(html).toContain("Transportadora Padrao Teste");
  });

  it("a transportadora do pedido vence a padrão; sem cadastro nada é inventado", () => {
    const own = buildOrderHtml(orderDetail(), "http://localhost", { customerRegistry: REGISTRY, carrierName: "Transportadora Do Pedido", customerDefaultCarrierName: "Transportadora Padrao Teste" });
    expect(own).toContain("Transportadora Do Pedido");
    expect(own).not.toContain("Transportadora Padrao Teste");
    expect(buildOrderHtml(orderDetail(), "http://localhost")).not.toContain("Rua Registro Teste");
  });
});
