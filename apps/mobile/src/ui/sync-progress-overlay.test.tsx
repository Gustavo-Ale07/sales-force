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
const running = (list: readonly SyncStep[], over: Partial<SyncStatus> = {}): SyncStatus => ({ ...idle, phase: "syncing", steps: list, ...over });
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
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount(status: SyncStatus, props: { onRetry?: () => void; onCancel?: () => void } = {}) {
  const onRetry = props.onRetry ?? jest.fn();
  const view = await renderWithModal(<SyncProgressOverlay status={status} onRetry={onRetry} onCancel={props.onCancel} />);
  const update = (next: SyncStatus) => act(async () => view.rerender(<SyncProgressOverlay status={next} onRetry={onRetry} onCancel={props.onCancel} />));
  return { update, onRetry };
}

describe("SyncProgressOverlay while running", () => {
  it("is a full-screen modal listing the seller's five steps, with no counts or times", async () => {
    const list = steps({ push: { state: "done", count: 2, total: 2 }, server: { state: "done" }, customers: { state: "running", count: 120, total: 480 } });
    const ctx = await mount(idle);
    await ctx.update(running(list));
    expect(screen.getByTestId("sync-screen")).toBeTruthy();
    expect(screen.getAllByText("Sincronizando").length).toBeGreaterThan(0);
    for (const label of ["Enviando pedidos", "Clientes", "Produtos e preços", "Condições de venda", "Finalizando"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/120/)).toBeNull();
    expect(screen.queryByText(/480/)).toBeNull();
    expect(screen.queryByText(/etapas/)).toBeNull();
    expect(screen.queryByText(/enviados/)).toBeNull();
  });

  it("the 'Enviando pedidos' step appears first only when there is something to send", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ push: { state: "running", total: 1 } })));
    expect(screen.getByTestId("sync-step-send")).toBeTruthy();
    await ctx.update(finished(steps({}, "done")));
    await ctx.update(running(steps()));
    expect(screen.queryByTestId("sync-step-send")).toBeNull();
  });

  it("is not shown at all when no full sync is running", async () => {
    await mount(idle);
    expect(screen.queryByText("Sincronizando")).toBeNull();
    expect(screen.queryByTestId("sync-screen")).toBeNull();
  });

  it("a run already finished when the screen mounts is not shown again", async () => {
    await mount(finished(steps({}, "done")));
    expect(screen.queryByText("Pronto")).toBeNull();
    expect(screen.queryByTestId("sync-screen")).toBeNull();
  });

  it("each row has an accessibility label with label and state only", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ customers: { state: "running", count: 5, total: 10 } })));
    expect(screen.getByTestId("sync-step-customers").props.accessibilityLabel).toBe("Clientes: em andamento");
    expect(screen.getByTestId("sync-step-products").props.accessibilityLabel).toBe("Produtos e preços: aguardando");
  });

  it("the overall bar follows the real progress", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps({ customers: { state: "done" }, server: { state: "done" } })));
    const bar = screen.getByTestId("sync-overall-bar");
    expect(bar.props.accessibilityValue.now).toBe(Math.round((2 / 8) * 100));
  });
});

describe("SyncProgressOverlay cancel", () => {
  it("offers 'Cancelar sincronização' only while running AND with a previous base", async () => {
    const onCancel = jest.fn();
    const ctx = await mount(idle, { onCancel });
    await ctx.update(running(steps(), { lastSyncedAt: null }));
    expect(screen.queryByTestId("sync-cancel")).toBeNull();
    await ctx.update(running(steps(), { lastSyncedAt: "2026-11-22T10:00:00.000Z" }));
    await fireEvent.press(screen.getByTestId("sync-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("has no cancel button when the screen supplies no handler", async () => {
    const ctx = await mount(idle);
    await ctx.update(running(steps(), { lastSyncedAt: "2026-11-22T10:00:00.000Z" }));
    expect(screen.queryByTestId("sync-cancel")).toBeNull();
  });
});

describe("SyncProgressOverlay on success", () => {
  it("shows a check per step, 'Pronto', announces, and closes by itself after 1 s", async () => {
    jest.useFakeTimers();
    const ctx = await mount(idle);
    await ctx.update(running(steps({ push: { state: "done", total: 1 }, server: { state: "running" } })));
    expect(screen.getAllByTestId("sync-step-check")).toHaveLength(1);

    await ctx.update(finished(steps({}, "done")));
    expect(screen.getByText("Pronto")).toBeTruthy();
    expect(screen.getAllByTestId("sync-step-check").length).toBeGreaterThanOrEqual(4);
    expect(announce).toHaveBeenCalledWith("Sincronização concluída.");

    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(screen.getByText("Pronto")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    expect(screen.queryByText("Pronto")).toBeNull();
    expect(screen.queryByTestId("sync-screen")).toBeNull();
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
    expect(screen.queryByText("Pronto")).toBeNull();
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
    expect(modalHostOf("sync-step-customers")?.props.animationType).toBe("fade");
  });

  it("reduced motion: no modal animation and the check is at full size at once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const ctx = await mount(idle);
    await ctx.update(running(steps({ server: { state: "done" }, customers: { state: "done" } })));
    await waitFor(() => expect(modalHostOf("sync-step-customers")?.props.animationType).toBe("none"));
    await waitFor(() => {
      const transform = StyleSheet.flatten(screen.getAllByTestId("sync-step-check")[0]!.props.style).transform as { scale: number }[];
      expect(transform[0]!.scale).toBe(1);
    });
  });
});
