// The mobile package carries no @types/node (no dependency added for one test): the three Node calls used here are typed locally.
declare const __dirname: string;
interface NodeFs {
  readdirSync(dir: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
  statSync(path: string): { isDirectory(): boolean };
}
interface NodePath {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readdirSync, readFileSync, statSync } = require("fs") as NodeFs;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join, relative } = require("path") as NodePath;

/**
 * Seller-visible text rules, enforced on the source (owner rulings of the Confirmar redesign):
 * no emoji / pictograph glyphs (icons are vector views), and the retired words never come back in user-facing strings.
 */
const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__mocks__" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && entry !== "test-doubles.ts" && entry !== "test-render.tsx" ? [path] : [];
  });
}

/** Code with comments removed: only string literals and JSX text can reach the screen. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, "")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FILES = sources(SRC).map((path) => ({ file: relative(SRC, path).replace(/\\/g, "/"), code: withoutComments(readFileSync(path, "utf8")) }));

// Emoji proper (Unicode Emoji_Presentation / Extended_Pictographic, plus the emoji variation selector and ZWJ). Plain text symbols such as a check mark or an arrow are not emoji and are not flagged here.
const EMOJI = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}]/u;

describe("seller-visible text rules (static scan of non-test source)", () => {
  it("scans the real source tree", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((f) => f.file === "ui/new-order-screen.tsx")).toBe(true);
  });

  it("contains no emoji or pictograph (icons are drawn as vector views)", () => {
    const hits = FILES.flatMap(({ file, code }) =>
      code.split("\n").flatMap((line, index) => {
        const match = EMOJI.exec(line);
        return match === null ? [] : [`${file}:${index + 1} U+${match[0].codePointAt(0)?.toString(16).toUpperCase()}`];
      }),
    );
    expect(hits).toEqual([]);
  });

  const RETIRED: ReadonlyArray<readonly [string, RegExp]> = [
    ["rascunho", /rascunho/i],
    ["estimado", /\bestimad[oa]s?\b/i],
    ["item(ns)", /item\(ns\)/i],
    ["Salvar pedido", /Salvar pedido/],
    ["Salvar orçamento", /Salvar orçamento/],
  ];

  // Only string literals / JSX text are checked: identifiers (e.g. `estimatedTotal`) are English and never match these Portuguese words.
  it.each(RETIRED)("never shows the retired word '%s'", (_name, pattern) => {
    const hits = FILES.flatMap(({ file, code }) =>
      code.split("\n").flatMap((line, index) => {
        const literals = line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]+</g) ?? [];
        return literals.some((text) => pattern.test(text) && !/^"(?:[a-z_]+)"$/.test(text)) ? [`${file}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
      }),
    );
    expect(hits).toEqual([]);
  });
});
