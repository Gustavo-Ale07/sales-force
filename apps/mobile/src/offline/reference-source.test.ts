import { datasetIdentityOf } from "./reference-source";

describe("datasetIdentityOf (single adapter for the server dataset declaration)", () => {
  it("maps a declared dataset", () => {
    expect(datasetIdentityOf({ dataset: { environment: "production", datasetId: "mirror-real-001" } })).toEqual({
      environment: "production",
      datasetId: "mirror-real-001",
    });
  });

  it("fails closed (null) when the server cannot tell", () => {
    expect(datasetIdentityOf({ dataset: null })).toBeNull();
    expect(datasetIdentityOf(null)).toBeNull();
    expect(datasetIdentityOf(undefined)).toBeNull();
  });

  it("treats a configuration cached before the field existed as unknown", () => {
    expect(datasetIdentityOf(JSON.parse('{"general":{"enabled":true}}') as { dataset: null })).toBeNull();
  });

  it("rejects empty identity parts", () => {
    expect(datasetIdentityOf({ dataset: { environment: "", datasetId: "x" } })).toBeNull();
    expect(datasetIdentityOf({ dataset: { environment: "sandbox", datasetId: "" } })).toBeNull();
  });
});
