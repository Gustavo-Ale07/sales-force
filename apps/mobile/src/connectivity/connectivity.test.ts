import { toConnectivityState } from "./connectivity";

describe("toConnectivityState", () => {
  it("is online only when the link and the internet are both confirmed", () => {
    expect(toConnectivityState({ isConnected: true, isInternetReachable: true })).toBe("online");
  });

  it("is offline as soon as either signal says so", () => {
    expect(toConnectivityState({ isConnected: false, isInternetReachable: false })).toBe("offline");
    expect(toConnectivityState({ isConnected: false })).toBe("offline");
    expect(toConnectivityState({ isConnected: true, isInternetReachable: false })).toBe("offline");
  });

  it("does not claim online without confirmation", () => {
    expect(toConnectivityState({})).toBe("unknown");
    expect(toConnectivityState({ isConnected: true })).toBe("unknown");
  });
});
