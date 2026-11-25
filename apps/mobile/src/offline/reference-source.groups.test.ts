import type { ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;

describe("fetchProductGroups (hierarchy for the offline Grupo > Subgrupo > Linha filter)", () => {
  it("reads GET /product-groups and returns the answer as the server delivers it, subtreeCodes included", async () => {
    const answer = {
      hierarchical: true,
      hasUngrouped: true,
      items: [{ code: 10, name: "Tintas", parentCode: null, degree: 1, hasChildren: false, subtreeCodes: [10, 11] }],
    };
    const asked: string[] = [];
    const api = {
      GET: async (path: string) => {
        asked.push(path);
        return { data: answer, response: ok };
      },
    } as unknown as ApiClient;
    expect(await createReferenceSource(api).fetchProductGroups!()).toEqual(answer);
    expect(asked).toEqual(["/product-groups"]);
  });

  it("surfaces a failure as a transport error (the pull treats it as non-fatal and keeps the previous tree)", async () => {
    const api = { GET: async () => ({ error: {}, response: { ok: false, status: 500, headers: new Headers() } as Response }) } as unknown as ApiClient;
    await expect(createReferenceSource(api).fetchProductGroups!()).rejects.toBeDefined();
  });
});
