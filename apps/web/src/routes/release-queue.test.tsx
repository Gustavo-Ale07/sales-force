import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { customersPage, customerDetail, dashboard, ordersPage } from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";

type Item = ApiSchema<"ReleaseQueueItem">;

const shellData: Handlers = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};

const item = (overrides: Partial<Item> = {}): Item => ({
  nunota: 5001,
  orderId: "0190a0c0-0000-7000-8000-0000000000b1",
  draftNumber: 12,
  sector: "Financeiro",
  event: 1,
  cascadeSequence: null,
  eventLabel: null,
  customerCode: 1001,
  customerName: "COMERCIAL ALFA LTDA",
  sellerCode: 7,
  sellerName: "VERA VENDEDORA",
  estimatedTotal: "250.00",
  topCode: 1010,
  orderedAt: "2026-11-20T13:00:00.000Z",
  waitingSince: "2026-11-20T13:00:00.000Z",
  waitingSinceSource: "order_time",
  waitingMinutes: 135,
  firstSeenAt: "2026-11-20T13:05:00.000Z",
  assignedUserCode: null,
  checkedAt: "2026-11-23T15:30:00.000Z",
  ...overrides,
});

const queue = (items: Item[]) => ({ items, page: 1, pageSize: 25, total: items.length });
const counts = (sectors: { sector: string; count: number }[] = [{ sector: "Financeiro", count: 2 }, { sector: "Pedidos", count: 1 }], total?: number) => ({
  total: total ?? sectors.reduce((sum, s) => sum + s.count, 0),
  sectors,
  lastCheckedAt: "2026-11-23T15:30:00.000Z",
});
const sellers = { items: [{ code: 7, name: "Vera Vendedora", active: true }, { code: 9, name: "Caio Comercial", active: true }] };

const base = (extra: Handlers = {}): Handlers => ({
  ...shellData,
  "GET /release-queue": { body: queue([item()]) },
  "GET /release-queue/count": { body: counts() },
  "GET /sellers": { body: sellers },
  ...extra,
});

const mainNav = () => screen.findByRole("navigation", { name: "Principal" });

describe("Aguardando liberação: states", () => {
  it("shows loading rows before the list answers", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    renderApp("/aguardando-liberacao", {
      handlers: base({
        "GET /release-queue": async () => {
          await gate;
          return { body: queue([item()]) };
        },
      }),
    });
    expect(await screen.findByRole("button", { name: "Atualizar agora" })).toBeInTheDocument();
    expect(screen.queryByText("5001")).toBeNull();
    release();
    expect(await screen.findByText("5001")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /release-queue": { body: queue([]) } }) });
    expect(await screen.findByText("Nenhum pedido aguardando liberação")).toBeInTheDocument();
  });

  it("shows a recoverable error and retries the list", async () => {
    let calls = 0;
    const { user } = renderApp("/aguardando-liberacao", {
      handlers: base({
        "GET /release-queue": () => {
          calls += 1;
          return calls === 1 ? apiError(500, "internal", "Falha", { requestId: "req-rq-1" }) : { body: queue([item()]) };
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByText("5001")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("shows the forbidden state on a 403 from the list, never a table of rows", async () => {
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /release-queue": apiError(403, "forbidden", "Sem permissão") }) });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
    expect(screen.queryByText("5001")).toBeNull();
  });

  it("renders the row data: value, TOP, waiting time, formatted dates", async () => {
    renderApp("/aguardando-liberacao", { handlers: base() });
    expect(await screen.findByText("5001")).toBeInTheDocument();
    expect(screen.getByText("2 h 15 min")).toBeInTheDocument();
    expect(screen.getByText("1010")).toBeInTheDocument();
    expect(screen.getByText(/250,00/)).toBeInTheDocument();
    expect(screen.getByText(/20\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByTestId("release-queue-checked-at")).toHaveTextContent("atualizado em 23/11/2026");
  });
});

describe("Aguardando liberação: coluna Nível", () => {
  it("shows the server text as it comes, and a dash when null or absent", async () => {
    const items = [
      item({ nunota: 7001, releaseLevel: { state: "awaiting", level: 2, text: "Nível 2" } }),
      item({ nunota: 7002, releaseLevel: { state: "not_confirmed", level: null, text: "Ainda não confirmado no Sankhya" } }),
      item({ nunota: 7003, releaseLevel: null }),
      item({ nunota: 7004 }),
    ];
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /release-queue": { body: queue(items) } }) });
    await screen.findByText("7001");
    expect(screen.getByRole("columnheader", { name: "Nível" })).toBeInTheDocument();
    expect(screen.getByText("Nível 2")).toBeInTheDocument();
    expect(screen.getByText("Ainda não confirmado no Sankhya")).toBeInTheDocument();
    expect(screen.queryByText(/Nível (0|1|3)/)).toBeNull();
  });
});

describe("Aguardando liberação: order and content", () => {
  it("keeps the rows in the order the server sent (oldest first), without re-sorting", async () => {
    const items = [
      item({ nunota: 9003, waitingMinutes: 3000 }),
      item({ nunota: 1002, waitingMinutes: 500 }),
      item({ nunota: 5001, waitingMinutes: 10 }),
    ];
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /release-queue": { body: queue(items) } }) });
    await screen.findByText("9003");
    const order = screen.getAllByRole("button", { name: /^Copiar número do pedido/ }).map((b) => b.getAttribute("aria-label")?.replace(/\D/g, ""));
    expect(order).toEqual(["9003", "1002", "5001"]);
  });

  it("carries no cost or margin text, no 'rascunho' and no emoji", async () => {
    const { container } = renderApp("/aguardando-liberacao", { handlers: base() });
    await screen.findByText("5001");
    const text = container.ownerDocument.body.textContent ?? "";
    expect(text).not.toMatch(/custo|margem/i);
    expect(text).not.toMatch(/rascunho/i);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("Aguardando liberação: URL filters", () => {
  it("sends the URL params to the API and reflects the sector choice in the URL", async () => {
    const { user, router, calls } = renderApp("/aguardando-liberacao?sellerCode=7", { handlers: base() });
    await screen.findByText("5001");
    expect(callsTo(calls, "GET", "/release-queue")[0]?.search.get("sellerCode")).toBe("7");
    await user.click(await screen.findByRole("radio", { name: /^Pedidos \(1\)/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ sector: "Pedidos", sellerCode: 7 }));
    await waitFor(() => expect(callsTo(calls, "GET", "/release-queue").some((c) => c.search.get("sector") === "Pedidos")).toBe(true));
    await user.click(screen.getByRole("radio", { name: /^Todos \(3\)/ }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("sector"));
    expect(router.state.location.search).toMatchObject({ sellerCode: 7 });
  });

  it("hides the sector control when the caller sees a single sector", async () => {
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 2 }]) } }) });
    await screen.findByText("5001");
    expect(screen.queryByRole("radiogroup", { name: "Setor" })).toBeNull();
  });

  it("the seller filter pushes sellerCode to the URL and resets the page", async () => {
    const { user, router } = renderApp("/aguardando-liberacao?page=2", { handlers: base() });
    await screen.findByText("5001");
    await user.selectOptions(screen.getByLabelText("Vendedor"), "9");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ sellerCode: 9 }));
    expect(router.state.location.search).not.toHaveProperty("page");
    await user.selectOptions(screen.getByLabelText("Vendedor"), "");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("sellerCode"));
  });

  it("hides the seller filter when the caller sees one seller only", async () => {
    renderApp("/aguardando-liberacao", { handlers: base({ "GET /sellers": { body: { items: [sellers.items[0]] } } }) });
    await screen.findByText("5001");
    expect(screen.queryByLabelText("Vendedor")).toBeNull();
  });

  it("ignores an invalid search value instead of sending it to the API", async () => {
    const { calls } = renderApp("/aguardando-liberacao?sellerCode=abc&pageSize=37", { handlers: base() });
    await screen.findByText("5001");
    const first = callsTo(calls, "GET", "/release-queue")[0];
    expect(first?.search.has("sellerCode")).toBe(false);
    expect(first?.search.get("pageSize")).toBe("25");
  });
});

describe("Aguardando liberação: Atualizar agora", () => {
  it("starts POST /sync/refresh and refetches the list when it is done", async () => {
    const ID = "0190a000-0000-7000-8000-0000000000f1";
    const body = (status: "pending" | "done") => ({
      id: ID,
      status,
      requestedAt: "2026-11-23T16:00:00.000Z",
      startedAt: "2026-11-23T16:00:01.000Z",
      finishedAt: status === "done" ? "2026-11-23T16:00:09.000Z" : null,
      steps: [],
    });
    const { user, calls } = renderApp("/aguardando-liberacao", {
      handlers: base({
        "POST /sync/refresh": { body: { ...body("pending"), reused: false } },
        [`GET /sync/refresh/${ID}`]: { body: body("done") },
      }),
    });
    await screen.findByText("5001");
    expect(callsTo(calls, "GET", "/release-queue")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Atualizar agora" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/sync/refresh")).toHaveLength(1));
    await waitFor(() => expect(callsTo(calls, "GET", "/release-queue").length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });

  it("says so when the refresh cannot start, and does not poll", async () => {
    const { user, calls } = renderApp("/aguardando-liberacao", {
      handlers: base({ "POST /sync/refresh": apiError(503, "unavailable", "Indisponível") }),
    });
    await screen.findByText("5001");
    await user.click(screen.getByRole("button", { name: "Atualizar agora" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível iniciar a atualização");
    expect(calls.some((c) => c.path.startsWith("/sync/refresh/"))).toBe(false);
  });
});

describe("Aguardando liberação: copy button", () => {
  it("copies the note number and announces it", async () => {
    const { user } = renderApp("/aguardando-liberacao", { handlers: base() });
    await user.click(await screen.findByRole("button", { name: "Copiar número do pedido 5001" }));
    await waitFor(() => expect(screen.getByText("Número copiado")).toBeInTheDocument());
    expect(await navigator.clipboard.readText()).toBe("5001");
  });

  it("on clipboard failure shows a toast with the number, never an alert dialog", async () => {
    const { user } = renderApp("/aguardando-liberacao", { handlers: base() });
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await user.click(await screen.findByRole("button", { name: "Copiar número do pedido 5001" }));
    expect(await screen.findByText("Não foi possível copiar")).toBeInTheDocument();
    expect(screen.getAllByText(/Selecione o número 5001/).length).toBeGreaterThan(0);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Número copiado")).toBeNull();
    spy.mockRestore();
    alertSpy.mockRestore();
  });
});

describe("Aguardando liberação: menu item", () => {
  const link = (nav: HTMLElement) => within(nav).queryByRole("link", { name: /Aguardando liberação/ });

  it("is shown with the badge when the count answers, and links to the screen", async () => {
    renderApp("/", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 3 }]) } }), role: "seller" });
    const nav = await mainNav();
    const item = await within(nav).findByRole("link", { name: /Aguardando liberação/ });
    expect(item).toHaveAttribute("href", "/aguardando-liberacao");
    expect(item).toHaveTextContent("3");
    expect(item).toHaveTextContent("3 pedidos aguardando");
  });

  it("uses the singular for one order", async () => {
    renderApp("/", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 1 }]) } }), role: "manager" });
    const item = await within(await mainNav()).findByRole("link", { name: /Aguardando liberação/ });
    expect(item).toHaveTextContent("1 pedido aguardando");
    expect(item).not.toHaveTextContent("1 pedidos");
  });

  it("caps the badge at 99+", async () => {
    renderApp("/", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 250 }]) } }), role: "admin" });
    const item = await within(await mainNav()).findByRole("link", { name: /Aguardando liberação/ });
    expect(item).toHaveTextContent("99+");
    expect(item).toHaveTextContent("250 pedidos aguardando");
  });

  it("shows exactly 99 without the plus", async () => {
    renderApp("/", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 99 }]) } }), role: "seller" });
    const item = await within(await mainNav()).findByRole("link", { name: /Aguardando liberação/ });
    expect(item).not.toHaveTextContent("99+");
    expect(item).toHaveTextContent("99");
  });

  it("keeps the item but hides the badge at zero", async () => {
    const { calls } = renderApp("/", { handlers: base({ "GET /release-queue/count": { body: counts([{ sector: "Financeiro", count: 0 }]) } }), role: "seller" });
    const item = await within(await mainNav()).findByRole("link", { name: /Aguardando liberação/ });
    expect(callsTo(calls, "GET", "/release-queue/count").length).toBeGreaterThan(0);
    expect(item).not.toHaveTextContent(/pedido/);
    expect(item.textContent?.trim()).toBe("Aguardando liberação");
  });

  it("is hidden when the count answers 403", async () => {
    const { calls } = renderApp("/", { handlers: base({ "GET /release-queue/count": apiError(403, "forbidden", "Sem permissão") }), role: "seller" });
    const nav = await mainNav();
    await waitFor(() => expect(callsTo(calls, "GET", "/release-queue/count")).toHaveLength(1));
    expect(link(nav)).toBeNull();
    expect(within(nav).getByRole("link", { name: /Vendas/ })).toBeInTheDocument();
  });

  it("is hidden when the count fails with a server error", async () => {
    const { calls } = renderApp("/", { handlers: base({ "GET /release-queue/count": apiError(500, "internal", "Falha") }), role: "manager" });
    const nav = await mainNav();
    await waitFor(() => expect(callsTo(calls, "GET", "/release-queue/count")).toHaveLength(1));
    expect(link(nav)).toBeNull();
  });

  it("is hidden when the count path is not answered at all (404)", async () => {
    const { calls } = renderApp("/", { handlers: { ...shellData }, role: "seller" });
    const nav = await mainNav();
    await waitFor(() => expect(callsTo(calls, "GET", "/release-queue/count")).toHaveLength(1));
    expect(link(nav)).toBeNull();
  });

  it("is not even requested for the technical profile", async () => {
    const { calls } = renderApp("/integracao", { handlers: base(), role: "technical" });
    const nav = await mainNav();
    await within(nav).findByRole("link", { name: /Integração/ });
    expect(link(nav)).toBeNull();
    expect(callsTo(calls, "GET", "/release-queue/count")).toHaveLength(0);
  });
});
