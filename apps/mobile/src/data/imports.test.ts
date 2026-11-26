import { ApiRequestError } from "./api";
import { canConfirmImport, decodedBytesOfBase64, describeImportError, errorReportText, fileProblem, remap, resultSummary, type ImportPreview, type ImportResult } from "./imports";

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  type: "order_items",
  fields: [],
  headers: ["Codigo", "Qtd"],
  mapping: { productCode: "Codigo", quantity: "Qtd" },
  missingRequired: [],
  totalRows: 3,
  recognized: 2,
  rejected: 1,
  skippedBlank: 0,
  sample: [],
  errors: [],
  errorsTruncated: false,
  ...over,
});

describe("import logic", () => {
  it("measures the decoded size of base64 text", () => {
    expect(decodedBytesOfBase64("QUJD")).toBe(3);
    expect(decodedBytesOfBase64("QUI=")).toBe(2);
    expect(decodedBytesOfBase64("QQ==")).toBe(1);
  });

  it("refuses other extensions and files over 20 MB before any upload", () => {
    expect(fileProblem("itens.xlsx", 1000)).toBeNull();
    expect(fileProblem("ITENS.CSV", null)).toBeNull();
    expect(fileProblem("itens.pdf", 10)).toBe("Escolha um arquivo .xlsx ou .csv.");
    expect(fileProblem("itens.xlsx", 20 * 1024 * 1024 + 1)).toBe("O arquivo é grande demais (limite de 20 MB).");
  });

  it("confirms only a recognised, fully mapped file (and a customer for items)", () => {
    expect(canConfirmImport(null, "customers", null)).toBe(false);
    expect(canConfirmImport(preview(), "order_items", null)).toBe(false);
    expect(canConfirmImport(preview(), "order_items", 7)).toBe(true);
    expect(canConfirmImport(preview({ missingRequired: ["quantity"] }), "customers", null)).toBe(false);
    expect(canConfirmImport(preview({ recognized: 0 }), "customers", null)).toBe(false);
    expect(canConfirmImport(preview(), "customers", null)).toBe(true);
  });

  it("remaps a field without touching the others; empty means not imported", () => {
    const next = remap({ a: "A", b: "B" }, "a", "");
    expect(next).toEqual({ a: null, b: "B" });
    expect(remap(next, "a", "C")).toEqual({ a: "C", b: "B" });
  });

  it("writes the error report and the result summary in pt-BR", () => {
    expect(errorReportText([{ row: 2, reason: "Produto não encontrado" }, { row: 5, reason: "Quantidade inválida" }])).toBe("Linha 2: Produto não encontrado\nLinha 5: Quantidade inválida");
    const result = { type: "customers", created: 3, rejected: 1, pending: 2, skippedBlank: 0, orderId: null, draftNumber: null, errors: [], errorsTruncated: false } as ImportResult;
    expect(resultSummary(result)).toBe("3 clientes cadastrados · 2 aguardando o ERP · 1 com erro");
    expect(resultSummary({ ...result, type: "order_items", pending: 0, rejected: 0 })).toBe("3 itens no orçamento");
  });

  it("explains failures in pt-BR", () => {
    expect(describeImportError(new ApiRequestError({ status: 0, message: "x" }), "f")).toMatch(/Sem conexão/);
    expect(describeImportError(new ApiRequestError({ status: 409, code: "dataset_mismatch", message: "x" }), "f")).toMatch(/outra base/);
    expect(describeImportError(new ApiRequestError({ status: 422, message: "Arquivo sem cabeçalho." }), "f")).toBe("Arquivo sem cabeçalho.");
    expect(describeImportError(new Error("boom"), "Não foi possível importar.")).toBe("Não foi possível importar.");
  });
});
