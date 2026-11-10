import { describe, expect, it } from "vitest";
import { cascadeLevels, groupFilterValue, type GroupPath } from "./group-cascade-filter";

const node = (code: number, name: string, parentCode: number | null, degree: number, hasChildren: boolean) => ({ code, name, parentCode, degree, hasChildren });

// Tubos(10) > Aço(11) > Aço 1"(111); Tubos > PVC(12, final at level 2); Serviços(20, final at level 1).
const items = [
  node(10, "Tubos", null, 1, true),
  node(11, "Aço", 10, 2, true),
  node(111, 'Aço 1"', 11, 3, false),
  node(12, "PVC", 10, 2, false),
  node(20, "Serviços", null, 1, false),
];
const levelsOf = (path: GroupPath, hasUngrouped = false) => cascadeLevels(items, true, hasUngrouped, path);
const labels = (path: GroupPath, hasUngrouped = false) => levelsOf(path, hasUngrouped).levels.map((l) => l.label);

describe("cascadeLevels", () => {
  it("starts with Grupo and a disabled Subgrupo; Linha is not shown", () => {
    const { levels } = levelsOf([]);
    expect(labels([])).toEqual(["Grupo", "Subgrupo"]);
    expect(levels[0]?.options.map((o) => o.label)).toEqual(["Tubos", "Serviços"]);
    expect(levels[1]).toMatchObject({ disabled: true, options: [] });
  });

  it("choosing a group with children enables Subgrupo with its children only", () => {
    const { levels } = levelsOf(["10"]);
    expect(levels[1]?.disabled).toBe(false);
    expect(levels[1]?.options.map((o) => o.label)).toEqual(["Aço", "PVC"]);
  });

  it("a final group at level 1 keeps Subgrupo off and hides Linha", () => {
    expect(labels(["20"])).toEqual(["Grupo", "Subgrupo"]);
    expect(levelsOf(["20"]).levels[1]?.disabled).toBe(true);
  });

  it("a final subgrupo at level 2 (PVC) hides Linha", () => {
    expect(labels(["10", "12"])).toEqual(["Grupo", "Subgrupo"]);
  });

  it("Linha appears only when the chosen subgrupo has children; a final line is level 3", () => {
    expect(labels(["10", "11"])).toEqual(["Grupo", "Subgrupo", "Linha"]);
    expect(levelsOf(["10", "11"]).levels[2]?.options.map((o) => o.label)).toEqual(['Aço 1"']);
    expect(levelsOf(["10", "11", "111"]).path).toEqual(["10", "11", "111"]);
  });

  it("an option that no longer exists cuts the path there", () => {
    expect(levelsOf(["10", "999", "111"]).path).toEqual(["10"]);
    expect(levelsOf(["999"]).path).toEqual([]);
  });

  it('offers "Sem grupo" only when there is an active product without a group, and it keeps Subgrupo off', () => {
    expect(levelsOf([], false).levels[0]?.options.some((o) => o.label === "Sem grupo")).toBe(false);
    const withNone = levelsOf(["0"], true);
    expect(withNone.levels[0]?.options.at(-1)).toEqual({ value: "0", label: "Sem grupo" });
    expect(withNone.levels[1]?.disabled).toBe(true);
    expect(withNone.path).toEqual(["0"]);
  });

  it("while the hierarchy is not mirrored (flat answer) only Grupo is shown", () => {
    const flat = [node(10, "Tubos", null, 1, false), node(20, "Serviços", null, 1, false)];
    expect(cascadeLevels(flat, false, false, []).levels.map((l) => l.label)).toEqual(["Grupo"]);
    expect(cascadeLevels(flat, false, false, ["10"]).levels.map((l) => l.label)).toEqual(["Grupo"]);
  });
});

describe("groupFilterValue", () => {
  it("is the deepest level chosen, or undefined for Todos", () => {
    expect(groupFilterValue([])).toBeUndefined();
    expect(groupFilterValue(["10"])).toBe(10);
    expect(groupFilterValue(["10", "11", "111"])).toBe(111);
    expect(groupFilterValue(["0"])).toBe(0);
  });
});
