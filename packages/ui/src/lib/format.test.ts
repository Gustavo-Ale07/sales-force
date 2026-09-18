import { describe, expect, it } from "vitest";
import {
  formatCnpj,
  formatCpf,
  formatDate,
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPercent,
  formatQuantity,
  initials,
} from "./format";

const plain = (s: string) => s.replaceAll(" ", " ");

describe("formatMoney", () => {
  it("formats decimal strings in pt-BR", () => {
    expect(plain(formatMoney("1234.5"))).toBe("R$ 1.234,50");
    expect(plain(formatMoney("0"))).toBe("R$ 0,00");
    expect(plain(formatMoney("-12.3"))).toMatch(/-R\$ 12,30/);
  });
  it("keeps precision beyond double range without arithmetic", () => {
    expect(plain(formatMoney("12345678901234.99"))).toBe("R$ 12.345.678.901.234,99");
  });
  it("supports unit-price precision", () => {
    expect(plain(formatMoney("10.123456", { maxFractionDigits: 6 }))).toBe("R$ 10,123456");
  });
  it("never shows a missing value as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined, { fallback: "Sem preço" })).toBe("Sem preço");
    expect(formatMoney("abc", { fallback: "Sem preço" })).toBe("Sem preço");
  });
});

describe("other number formats", () => {
  it("formats quantity and percent", () => {
    expect(formatQuantity("1500.5")).toBe("1.500,5");
    expect(formatPercent("64")).toBe("64,0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formats date-only values without timezone shift", () => {
    expect(formatDate("2026-09-18")).toBe("18/09/2026");
  });
  it("formats instants with a fixed time zone", () => {
    expect(formatDate("2026-09-18T02:30:00Z", { timeZone: "America/Sao_Paulo" })).toBe("17/09/2026");
    expect(formatDateTime("2026-09-18T17:05:00Z", { timeZone: "America/Sao_Paulo" })).toBe("18/09/2026 14:05");
  });
  it("falls back on invalid input", () => {
    expect(formatDate("nope")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });
});

describe("documents", () => {
  it("masks CNPJ, CPF and alphanumeric CNPJ", () => {
    expect(formatCnpj("11111111000111")).toBe("11.111.111/0001-11");
    expect(formatCpf("12345678901")).toBe("123.456.789-01");
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatDocument("123")).toBe("123");
    expect(formatDocument(null)).toBe("—");
  });
  it("builds initials", () => {
    expect(initials("Ana Maria Ribeiro")).toBe("AR");
    expect(initials("Ana")).toBe("A");
    expect(initials(null)).toBe("?");
  });
});
