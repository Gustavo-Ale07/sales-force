import { screen, within } from "@testing-library/react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { APP_BUILD_LABEL, APP_VERSION } from "../app-info";
import { account } from "../test-doubles";
import { ProfileScreen } from "./profile-screen";
import { renderWithModal } from "./test-modal-wrapper";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

describe("ProfileScreen version row", () => {
  it("shows the build label (version and APK/OTA origin) next to 'Versão'", async () => {
    await renderWithModal(<ProfileScreen account={account} status={idle} connectivity="online" onSyncNow={() => undefined} onSignOut={() => undefined} />);
    expect(screen.getByText("Versão")).toBeTruthy();
    expect(screen.getByText(APP_BUILD_LABEL)).toBeTruthy();
    expect(APP_BUILD_LABEL.startsWith(APP_VERSION)).toBe(true);
    expect(APP_BUILD_LABEL).toMatch(/ · (pacote do APK|atualização \w+)$/);
  });

  it("keeps the label and the row in the same line of the card", async () => {
    await renderWithModal(<ProfileScreen account={account} status={idle} connectivity="online" onSyncNow={() => undefined} onSignOut={() => undefined} />);
    const label = screen.getByText("Versão");
    const row = label.parent;
    expect(row).toBeTruthy();
    expect(within(row as never).getByText(APP_BUILD_LABEL)).toBeTruthy();
  });
});
