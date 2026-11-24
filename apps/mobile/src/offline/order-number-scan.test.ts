export {};
// The mobile package carries no @types/node: the Node calls used here are typed locally (same approach as visible-text-rules.test.ts).
declare const __dirname: string;
interface NodeFs {
  readdirSync(dir: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
  statSync(path: string): { isDirectory(): boolean };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readdirSync, readFileSync, statSync } = require("fs") as NodeFs;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("path") as { join(...parts: string[]): string };

/**
 * The internal Force number (`remoteDraftNumber` / `draftNumber`) is never shown. The only number a seller sees is the Sankhya
 * number, and only once it exists. This scan keeps the app sources from printing the internal one again.
 */
const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "test-doubles.ts") out.push(path);
  }
  return out;
}

describe("the internal Force number is never printed", () => {
  const files = sources(SRC);

  it("scans the app sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no source mentions the user-visible 'Force nº' wording", () => {
    const offenders = files.filter((file) => /Force nº/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no UI source reads remoteDraftNumber or draftNumber", () => {
    const offenders = files
      .filter((file) => /[\\/]ui[\\/]/.test(file))
      .filter((file) => /\b(remoteDraftNumber|draftNumber)\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the PDF model is built without the internal number", () => {
    const pdf = readFileSync(join(SRC, "offline", "order-pdf.ts"), "utf8");
    expect(pdf).not.toMatch(/draftNumber/);
  });
});
