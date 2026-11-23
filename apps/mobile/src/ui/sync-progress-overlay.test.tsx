import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";
import type { SyncStatus, SyncStep, SyncStepId, SyncStepState } from "@salesforce/mobile-db";
import { SyncProgressOverlay } from "./sync-progress-overlay";
import { renderWithModal } from "./test-modal-wrapper";

const IDS: SyncStepId[] = ["push", "server", "customers", "products", "prices", "negotiation", "carriers", "save", "orders"];

function steps(states: Partial<Record<SyncStepId, Partial<SyncStep> & { state: SyncStepState }>> = {}, fallback: SyncStepState = "pending"): readonly SyncStep[] {
  return IDS.map((id) => ({ id, state: fallback, count: null, total: null, indeterminate: false, ...states[id] }));
}

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const running = (list: readonly SyncStep[]): SyncStatus => ({ ...idle, phase: "syncing", steps: list });
const finished = (list: readonly SyncStep[]): SyncStatus => ({ ...idle, phase: "idle", lastSyncedAt: "2026-11-23T12:00:00.000Z", steps: list });
const failedRun = (list: readonly SyncStep[], failure: NonNullable<SyncStatus["failure"]>, lastError = "falha"): SyncStatus => ({
  ...idle,
  phase: "offline",
  failure,
  lastError,
  steps: list,
});

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  announce.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function mount(status: SyncStatus, onRetry = jest.fn()) {
  const view = await renderWithModal(<SyncProgressOverlay status={status} onRetry={onRetry} />);
  const update = (next: SyncStatus) => act(async () => view.rerender(<SyncProgressOverlay status={next} onRetry={onRetry} />));
  return { update, onRetry };
}

describe("SyncProgressOverlay while running", () => {
  it("shows the list with the real counts of each step", async () => {
    const list = steps({ push: { state: "done", count: 2 }, server: { state: "done" }, customers: { state: "running", count: 120, total: 480 } });
    const ctx = await mount(idle);
    await ctx.update(running(list));
    expect(screen.getAllByText("Sincronizando").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 de 9 etapas · não feche o aplicativo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("120 de 480").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 enviados").length).toBeGreaterThan(0);
  });

  it("is not shown at all when no full sync is running", async () => {
    await mount(idle);
    expect(screen.queryByText("Sincronizando")).toBeNull();
    expect(screen.queryByTestId("sync-step-push")).toBeNull();
  });

  it("a run already finished when the screen mounts is not shown again", async () => {
    await mount(finished(steps({}, "done")));
    expect(screen.queryByText("Dados atualizados")).toBeNull();
    expect(screen.queryByTestId("sync-step-push")).toBeNull();
  });

  it("each row has an accessibility label with label, state and count", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ customers: { state: "running", count: 5, total: 10 } })));
    expect(screen.getByTestId("sync-step-customers").props.accessibilityLabel).toBe("Clientes: em andamento, 5 de 10");
    expect(screen.getByTestId("sync-step-prices").props.accessibilityLabel).toBe("Preços: aguardando");
  });
});

describe("SyncProgressOverlay on success", () => {
  it("shows a check per finished step, then 'Dados atualizados', announces, and closes by itself", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ push: { state: "done", count: 0 }, server: { state: "running" } })));
    expect(screen.getAllByTestId("sync-step-check")).toHaveLength(1);

    const all = steps({}, "done");
    await ctx.update(finished(all));
    expect(screen.getAllByTestId("sync-step-check").length).toBeGreaterThanOrEqual(IDS.length);
    expect(screen.getByText("Dados atualizados")).toBeTruthy();
    expect(screen.getByText("Tudo pronto para trabalhar.")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Sincronização concluída. Dados atualizados.");

    await waitFor(() => expect(screen.queryByText("Dados atualizados")).toBeNull(), { timeout: 4000 });
    expect(screen.queryByTestId("sync-step-push")).toBeNull();
  });

  it("does not open the error popup", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    await ctx.update(finished(steps({}, "done")));
    expect(screen.queryByTestId("app-modal")).toBeNull();
  });
});

describe("SyncProgressOverlay on failure", () => {
  it.each([
    ["no_internet", "Sem conexão"],
    ["server_unavailable", "Servidor indisponível"],
    ["sankhya_unavailable", "Sankhya indisponível"],
    ["auth", "Sessão expirada"],
    ["error", "Não foi possível sincronizar"],
  ] as const)("failure %s closes the overlay and opens the popup '%s'", async (failure, title) => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ push: { state: "done" }, server: { state: "running" } })));
    expect(screen.getAllByText("Sincronizando").length).toBeGreaterThan(0);
    await ctx.update(failedRun(steps({ push: { state: "done" }, server: { state: "error" } }), failure));
    expect(within(await screen.findByTestId("app-modal")).getByText(title)).toBeTruthy();
    expect(screen.queryByText("Sincronizando")).toBeNull();
    expect(screen.queryByText("Dados atualizados")).toBeNull();
    expect(announce).toHaveBeenCalledWith("A sincronização não terminou.");
  });

  it("the technical text goes behind 'Ver detalhes' with the code of the failure", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    await ctx.update(failedRun(steps({ server: { state: "error" } }), "error", "boom interno"));
    const popup = await screen.findByTestId("app-modal");
    await fireEvent.press(within(popup).getByText("Ver detalhes"));
    expect(screen.getByTestId("app-modal-details").props.children).toContain("boom interno");
    expect(screen.getByTestId("app-modal-details").props.children).toContain("sync_failed");
  });

  it("'Tentar de novo' calls onRetry once", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    await ctx.update(failedRun(steps({ server: { state: "error" } }), "server_unavailable"));
    await fireEvent.press(within(await screen.findByTestId("app-modal")).getByRole("button", { name: "Tentar de novo" }));
    expect(ctx.onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("app-modal")).toBeNull());
  });

  it("an auth failure offers no retry (the screen supplies no handler for 'Entrar de novo' here)", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    await ctx.update(failedRun(steps({ server: { state: "error" } }), "auth"));
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(ctx.onRetry).not.toHaveBeenCalled();
  });

  it("the same failed run is announced once, not on every re-render", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    const failed = failedRun(steps({ server: { state: "error" } }), "no_internet");
    await ctx.update(failed);
    await fireEvent.press(within(await screen.findByTestId("app-modal")).getByRole("button", { name: "Fechar" }));
    await ctx.update({ ...failed });
    expect(screen.queryByTestId("app-modal")).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe("SyncProgressOverlay motion", () => {
  function modalHostOf(testId: string) {
    let node = screen.getByTestId(testId).parent;
    while (node !== null && node !== undefined && node.props.animationType === undefined) node = node.parent;
    return node;
  }

  it("fades in with motion allowed", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps()));
    expect(modalHostOf("sync-step-push")?.props.animationType).toBe("fade");
  });

  it("reduced motion: no modal animation and the check is at full size at once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const ctx = await mount(idle);
    await ctx.update(running(steps({ push: { state: "done", count: 1 } })));
    await waitFor(() => expect(modalHostOf("sync-step-push")?.props.animationType).toBe("none"));
    const check = screen.getAllByTestId("sync-step-check")[0]!;
    await waitFor(() => {
      const transform = StyleSheet.flatten(screen.getAllByTestId("sync-step-check")[0]!.props.style).transform as { scale: number }[];
      expect(transform[0]!.scale).toBe(1);
    });
    expect(check).toBeTruthy();
  });
});
