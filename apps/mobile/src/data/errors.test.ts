import { ApiRequestError } from "./api";
import { describeDataError } from "./errors";

describe("describeDataError", () => {
  it("says the data is online-only when there is no connection", () => {
    const info = describeDataError(new ApiRequestError({ status: 0, message: "x" }));
    expect(info.kind).toBe("offline");
    expect(info.message).toContain("somente online".replace("somente", "só estão disponíveis"));
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [500, "unexpected"],
  ] as const)("maps HTTP %i to %s", (status, kind) => {
    expect(describeDataError(new ApiRequestError({ status, message: "x", correlationId: "req-1" }))).toMatchObject({
      kind,
      correlationId: "req-1",
    });
  });

  it("never leaks the raw message of an unknown failure", () => {
    expect(describeDataError(new Error("select * from secret"))).toEqual({
      kind: "unexpected",
      message: "Ocorreu um erro inesperado. Tente novamente.",
    });
  });
});
