import { NO_GROUP_CODE, cascadeLevels, groupCodesOf, groupPathLabel, type ProductGroupTree } from "./group-cascade";

const node = (code: number, name: string, parentCode: number | null, hasChildren: boolean, subtreeCodes: number[]) => ({ code, name, parentCode, degree: 1, hasChildren, subtreeCodes });

const TREE: ProductGroupTree = {
  hierarchical: true,
  hasUngrouped: true,
  items: [
    node(10, "Tintas", null, true, [10, 11, 12]),
    node(11, "Esmaltes", 10, true, [11, 12]),
    node(12, "Brilhantes", 11, false, [12]),
    node(20, "Solventes", null, false, [20]),
  ],
};

const values = (levels: ReturnType<typeof cascadeLevels>["levels"]) => levels.map((l) => [l.label, l.value, l.disabled, l.options.map((o) => o.value)]);

describe("cascadeLevels (mirror of the site's group cascade)", () => {
  it("starts with Grupo (plus Sem grupo) and a disabled Subgrupo", () => {
    const { levels, path } = cascadeLevels(TREE, []);
    expect(path).toEqual([]);
    expect(values(levels)).toEqual([
      ["Grupo", null, false, [10, 20, NO_GROUP_CODE]],
      ["Subgrupo", null, true, []],
    ]);
  });

  it("opens Subgrupo for a group with children and Linha for a subgrupo with children", () => {
    expect(values(cascadeLevels(TREE, [10]).levels)).toEqual([
      ["Grupo", 10, false, [10, 20, NO_GROUP_CODE]],
      ["Subgrupo", null, false, [11]],
    ]);
    expect(values(cascadeLevels(TREE, [10, 11]).levels)).toEqual([
      ["Grupo", 10, false, [10, 20, NO_GROUP_CODE]],
      ["Subgrupo", 11, false, [11]],
      ["Linha", null, false, [12]],
    ]);
  });

  it("keeps Subgrupo disabled for a final group and for Sem grupo, and never shows Linha", () => {
    expect(values(cascadeLevels(TREE, [20]).levels)).toEqual([
      ["Grupo", 20, false, [10, 20, NO_GROUP_CODE]],
      ["Subgrupo", null, true, []],
    ]);
    expect(cascadeLevels(TREE, [NO_GROUP_CODE]).levels).toHaveLength(2);
  });

  it("cuts the path where it is no longer an option (data changed under the selection)", () => {
    expect(cascadeLevels(TREE, [10, 99]).path).toEqual([10]);
    expect(cascadeLevels(TREE, [77]).path).toEqual([]);
  });

  it("offers Sem grupo only when some product has no group", () => {
    const { levels } = cascadeLevels({ ...TREE, hasUngrouped: false }, []);
    expect(levels[0]?.options.map((o) => o.value)).toEqual([10, 20]);
  });

  it("flat answer: Grupo alone, every group at the top", () => {
    const flat: ProductGroupTree = { hierarchical: false, hasUngrouped: false, items: [node(1, "A", null, false, [1]), node(2, "B", null, false, [2])] };
    const { levels } = cascadeLevels(flat, [2]);
    expect(values(levels)).toEqual([["Grupo", 2, false, [1, 2]]]);
  });

  it("names the option with the group name", () => {
    expect(cascadeLevels(TREE, []).levels[0]?.options.map((o) => o.label)).toEqual(["Tintas", "Solventes", "Sem grupo"]);
  });
});

describe("groupCodesOf and groupPathLabel", () => {
  it("filters by the subtree of the deepest level chosen", () => {
    expect(groupCodesOf(TREE, [10])).toEqual([10, 11, 12]);
    expect(groupCodesOf(TREE, [10, 11])).toEqual([11, 12]);
    expect(groupCodesOf(TREE, [10, 11, 12])).toEqual([12]);
  });

  it("Sem grupo filters by code 0; Todos (empty path) filters by nothing", () => {
    expect(groupCodesOf(TREE, [NO_GROUP_CODE])).toEqual([0]);
    expect(groupCodesOf(TREE, [])).toEqual([]);
  });

  it("labels the deepest level with its level name", () => {
    expect(groupPathLabel(TREE, [10])).toBe("Grupo: Tintas");
    expect(groupPathLabel(TREE, [10, 11])).toBe("Subgrupo: Esmaltes");
    expect(groupPathLabel(TREE, [10, 11, 12])).toBe("Linha: Brilhantes");
    expect(groupPathLabel(TREE, [NO_GROUP_CODE])).toBe("Grupo: Sem grupo");
  });
});
