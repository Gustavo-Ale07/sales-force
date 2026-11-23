import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { orderReference } from "./labels";
import { buildOrderHtml } from "./order-print";
import { orderDetail } from "../test/fixtures";

describe("identidade do pedido: só o número do Sankhya", () => {
  it("sem número do Sankhya mostra só 'Pedido' ou 'Orçamento'", () => {
    expect(orderReference({ erpNumber: null })).toBe("Pedido");
    expect(orderReference({ erpNumber: null }, "quote")).toBe("Orçamento");
  });

  it("com número do Sankhya mostra 'Pedido nº N'", () => {
    expect(orderReference({ erpNumber: 2511 })).toBe("Pedido nº 2511");
    expect(orderReference({ erpNumber: 2511 }, "quote")).toBe("Orçamento nº 2511");
  });

  it("o documento impresso não traz o número interno", () => {
    const html = buildOrderHtml(orderDetail({ draftNumber: 7731, erpNumber: null }), "http://localhost");
    expect(html).not.toContain("7731");
    expect(html).not.toMatch(/Force nº/);
    const sent = buildOrderHtml(orderDetail({ draftNumber: 7731, erpNumber: 2511 }), "http://localhost");
    expect(sent).not.toContain("7731");
    expect(sent).toContain("2511");
  });

  it("nenhum código-fonte lê o número interno para exibição", () => {
    const SRC = join(process.cwd(), "src") + sep;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(SRC);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const path of files) {
      if (/[\\/]test[\\/]/.test(path)) continue;
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/\.draftNumber\b|Force nº|Rascunho nº/.test(line)) offenders.push(`${path.slice(SRC.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
