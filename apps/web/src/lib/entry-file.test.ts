import { describe, expect, it } from "vitest";
import { EntryFileError, entryFileKind, pdfLinesToEntryText, readEntryFile, rowsToEntryText } from "./entry-file";

describe("entryFileKind", () => {
  it.each([
    ["pedido.xlsx", "", "excel"],
    ["PEDIDO.XLSX", "", "excel"],
    ["lista.pdf", "", "pdf"],
    ["sem-extensao", "application/pdf", "pdf"],
    ["lista.csv", "", "text"],
    ["lista.txt", "text/plain", "text"],
  ] as const)("recognizes %s", (name, type, kind) => {
    expect(entryFileKind({ name, type })).toBe(kind);
  });

  it("does not recognize other formats", () => {
    expect(entryFileKind({ name: "lista.docx", type: "" })).toBeNull();
    expect(entryFileKind({ name: "lista.xls", type: "" })).toBeNull();
  });
});

describe("rowsToEntryText", () => {
  it("keeps the first two columns as identifier;quantity with a decimal comma", () => {
    expect(rowsToEntryText([["2001", 5], ["FITA-AZ", 2.5, "ignorado"], [3003, 10]])).toBe("2001;5\nFITA-AZ;2,5\n3003;10");
  });

  it("drops rows without identifier and keeps an identifier without quantity", () => {
    expect(rowsToEntryText([[null, 3], ["", 2], ["2001", null]])).toBe("2001");
  });

  it("removes separators typed inside a cell so the format cannot be broken", () => {
    expect(rowsToEntryText([["20;01\nX", "1"]])).toBe("20 01 X;1");
  });
});

describe("pdfLinesToEntryText", () => {
  it("reads only lines that are exactly `identifier quantity` and counts the rest as ignored", () => {
    const result = pdfLinesToEntryText(["Pedido de compra", "2001 5", "BL-09-VM   2,5", "", "Total 12 itens", "3003 1.5"]);
    expect(result.text).toBe("2001;5\nBL-09-VM;2,5\n3003;1,5");
    expect(result.ignoredLines).toBe(2);
  });
});

describe("readEntryFile", () => {
  it("reads CSV/TXT as they are", async () => {
    const file = new File(["2001;5\n2003;2"], "lista.csv", { type: "text/csv" });
    await expect(readEntryFile(file)).resolves.toEqual({ text: "2001;5\n2003;2", ignoredLines: 0 });
  });

  it("refuses an unsupported format", async () => {
    const error = await readEntryFile(new File(["x"], "lista.docx")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryFileError);
    expect((error as EntryFileError).reason).toBe("unsupported");
  });

  it("refuses a file that is not a valid PDF or spreadsheet", async () => {
    for (const name of ["ruim.pdf", "ruim.xlsx"]) {
      const error = await readEntryFile(new File(["isto não é um arquivo válido"], name)).catch((e: unknown) => e);
      expect((error as EntryFileError).reason).toBe("unreadable");
    }
  });
});
