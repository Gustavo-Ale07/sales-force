import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { SyncManager, SyncStatus, SyncStep, SyncStepId } from "@salesforce/mobile-db";
import { account, fakeAuth, fakeDependencies, fakeLocalOrders } from "../test-doubles";
import type { OfflineServices } from "../offline/services";
import { Shell } from "./shell";

const IDS: SyncStepId[] = ["push", "server", "customers", "products", "prices", "negotiation", "carriers", "save", "orders"];
const steps = (over: Partial<Record<SyncStepId, Partial<SyncStep>>> = {}, state: SyncStep["state"] = "pending"): readonly SyncStep[] =>
  IDS.map((id) => ({ id, state, count: null, total: null, indeterminate: false, ...over[id] }));

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

/** Offline services whose sync status the test drives by hand (`emit`). */
function controllable() {
  let listener: ((status: SyncStatus) => void) | null = null;
  let current = idle;
  const syncCalls: string[] = [];
  const sync: SyncManager = {
    sync: jest.fn(async (reason: string) => {
      syncCalls.push(reason);
      return current;
    }) as unknown as SyncManager["sync"],
    getStatus: () => current,
    subscribe: (next) => {
      listener = next;
      return () => undefined;
    },
    refresh: async () => current,
  };
  const offline: OfflineServices = {
    unsentWork: async () => 0,
    endSession: async () => ({ cleared: true, unsent: 0 }),
    wipeAll: async () => undefined,
    session: { load: async () => ({ account, lastOnlineAt: new Date().toISOString() }), remember: async () => undefined, forget: async () => undefined },
    forAccount: () => ({
      repositories: fakeDependencies().repositories,
      localOrders: fakeLocalOrders(),
      pendingCustomers: { create: jest.fn(), submit: jest.fn(), assignSeller: jest.fn(), creationAvailable: async () => true, list: async () => [], resend: async () => undefined, discard: async () => undefined },
      sync,
    }),
  };
  const emit = (status: SyncStatus) => act(async () => {
    current = status;
    listener?.(status);
  });
  return { offline, emit, syncCalls };
}

const mountShell = (offline: OfflineServices) => render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => account }), offline })} />);

describe("Shell mounts the sync progress overlay", () => {
  it("shows the real steps while a full sync runs and closes by itself after success", async () => {
    const ctx = controllable();
    await mountShell(ctx.offline);
    expect(await screen.findByText("Olá, Ana Vendedora")).toBeTruthy();
    expect(screen.queryByTestId("sync-step-push")).toBeNull();

    await ctx.emit({ ...idle, phase: "syncing", steps: steps({ push: { state: "done", count: 0 }, customers: { state: "running", count: 10, total: 40 } }) });
    expect(screen.getByTestId("sync-step-customers").props.accessibilityLabel).toBe("Clientes: em andamento");

    await ctx.emit({ ...idle, lastSyncedAt: "2026-11-23T12:00:00.000Z", steps: steps({}, "done") });
    expect(screen.getByText("Pronto")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("sync-step-push")).toBeNull(), { timeout: 4000 });
  });

  it("a failed run opens the popup; 'Tentar de novo' runs the manual sync again", async () => {
    const ctx = controllable();
    await mountShell(ctx.offline);
    await screen.findByText("Olá, Ana Vendedora");
    await ctx.emit({ ...idle, phase: "syncing", steps: steps({ server: { state: "running" } }) });
    await ctx.emit({ ...idle, phase: "offline", failure: "server_unavailable", lastError: "x", steps: steps({ server: { state: "error" } }) });
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("Servidor indisponível")).toBeTruthy();
    await fireEvent.press(within(popup).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(ctx.syncCalls).toContain("manual"));
  });

  it("an authentication failure offers 'Entrar de novo' (the shell default) and returns to the login", async () => {
    const ctx = controllable();
    await mountShell(ctx.offline);
    await screen.findByText("Olá, Ana Vendedora");
    await ctx.emit({ ...idle, phase: "syncing", steps: steps() });
    await ctx.emit({ ...idle, phase: "auth_required", failure: "auth", lastError: "401", steps: steps({ server: { state: "error" } }) });
    const popup = await screen.findByTestId("app-modal");
    expect(within(popup).getByText("Sessão expirada")).toBeTruthy();
    await fireEvent.press(within(popup).getByRole("button", { name: "Entrar de novo" }));
    expect(await screen.findByLabelText("Usuário")).toBeTruthy();
  });
});
