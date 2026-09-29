import { newClientRequestId } from "./uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newClientRequestId", () => {
  it("returns a well-formed UUIDv4", () => {
    expect(newClientRequestId()).toMatch(UUID_V4);
  });

  it("returns a different value on each call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newClientRequestId()));
    expect(ids.size).toBe(50);
  });
});
