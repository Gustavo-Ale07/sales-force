import { releaseViewOf } from "./release-status";

describe("releaseViewOf", () => {
  it("shows the three states with the owner labels and a calm message for awaiting", () => {
    expect(releaseViewOf({ erpRelease: { state: "awaiting" } })).toMatchObject({ label: "Aguardando liberação", tone: "warning", message: "Enviado ao Sankhya, aguardando liberação." });
    expect(releaseViewOf({ erpRelease: { state: "released" } })).toMatchObject({ label: "Liberado", tone: "success" });
    expect(releaseViewOf({ erpRelease: { state: "denied" } })).toMatchObject({ label: "Negado", tone: "danger" });
  });

  it("lists the events with their description, or 'evento N' when there is none", () => {
    const view = releaseViewOf({
      erpRelease: {
        state: "denied",
        events: [
          { code: 3, label: "Limite de crédito", state: "released" },
          { code: 13, label: null, state: "denied" },
          { code: "x", state: "denied" },
        ],
      },
    });
    expect(view?.events).toEqual(["Limite de crédito: liberado", "evento 13: negado"]);
  });

  it("is null without a usable release in the snapshot", () => {
    expect(releaseViewOf(null)).toBeNull();
    expect(releaseViewOf({})).toBeNull();
    expect(releaseViewOf({ erpRelease: null })).toBeNull();
    expect(releaseViewOf({ erpRelease: { state: "other" } })).toBeNull();
  });
});
