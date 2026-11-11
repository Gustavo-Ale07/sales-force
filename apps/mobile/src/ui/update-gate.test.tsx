import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import type { LatestRelease } from "../update/apk-update";
import { UpdateGate } from "./update-gate";

const release: LatestRelease = { channel: "staging", versionName: "0.3.0", versionCode: 12, minVersionCode: 10, file: "f.apk", sha256: "a".repeat(64), sizeBytes: 5 };
const app = <Text>Aplicativo</Text>;

describe("UpdateGate", () => {
  it("shows the app straight away and stays out of the way when there is no check", async () => {
    await render(<UpdateGate install={jest.fn()}>{app}</UpdateGate>);
    expect(screen.getByText("Aplicativo")).toBeTruthy();
  });

  it("keeps the app visible while the check is pending and after an open result", async () => {
    let finish: (v: { kind: "open" }) => void = () => undefined;
    const check = jest.fn(() => new Promise<{ kind: "open" }>((resolve) => { finish = resolve; }));
    await render(<UpdateGate check={check} install={jest.fn()}>{app}</UpdateGate>);
    expect(screen.getByText("Aplicativo")).toBeTruthy();
    finish({ kind: "open" });
    await waitFor(() => expect(screen.getByText("Aplicativo")).toBeTruthy());
  });

  it("keeps the app when the check itself fails", async () => {
    const check = jest.fn(async () => { throw new Error("boom"); });
    await render(<UpdateGate check={check} install={jest.fn()}>{app}</UpdateGate>);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(screen.getByText("Aplicativo")).toBeTruthy();
  });

  it("replaces the app with the blocking screen when the update is required, and installs on request", async () => {
    const install = jest.fn(async () => "Baixada e verificada.");
    const check = jest.fn(async () => ({ kind: "required" as const, release }));
    await render(<UpdateGate check={check} install={install}>{app}</UpdateGate>);
    await waitFor(() => expect(screen.getByText("Atualização obrigatória")).toBeTruthy());
    expect(screen.queryByText("Aplicativo")).toBeNull();
    expect(screen.getByText(/0\.3\.0/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Baixar e instalar" }));
    await waitFor(() => expect(screen.getByText("Baixada e verificada.")).toBeTruthy());
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Aplicativo")).toBeNull();
  });
});
