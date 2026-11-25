import { screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiSchema } from "@salesforce/contracts/client";
import { ORDER_STAGE_LABELS } from "@salesforce/domain";
import { ORDER_STAGE_FILTERS, parseOrdersSearch, SENT_ORDER_STAGES } from "../lib/route-search";
import { customer, customerDetail, customersPage, ORDER_ID, orderDetail, orderListItem, ordersPage, product, productsPage } from "../test/fixtures";
import { apiError, callsTo, openRefresh, renderApp, type Handlers } from "../test/harness";

type Stage = NonNullable<ApiSchema<"OrderDetail">["erpStage"]>;

const stage = (code: Stage["stage"], overrides: Partial<Stage> = {}): Stage => ({
  stage: code,
  label: ORDER_STAGE_LABELS[code],
  pendingSector: null,
  nunota: null,
  invoiceNumber: null,
  updatedAt: "2026-11-23T14:00:00.000Z",
  checkedAt: "2026-11-23T15:30:00.000Z", // 12:30 in São Paulo
  readError: null,
  ...overrides,
});

const sentOrder = (erpStage: Stage | null | undefined, overrides: Partial<ApiSchema<"OrderDetail">> = {}) =>
  orderDetail({ status: "sent", erpNumber: 5001, ...(erpStage === undefined ? {} : { erpStage }), ...overrides });

const detailHandlers = (order: ApiSchema<"OrderDetail">, extra: Handlers = {}): Handlers => ({
  "GET /orders/:id": { body: order },
  "GET /products": { body: productsPage([product()]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  ...extra,
});

const TIMELINE_LABELS = ["Recebido", "Em revisão", "Conferência financeira", "Na expedição", "No faturamento", "Faturado"];
const TIMELINE_CODES = ["received", "in_review", "financial_check", "in_dispatch", "in_invoicing", "invoiced"] as const;

async function panel() {
  return screen.findByRole("region", { name: "Situação no Sankhya" });
}

describe("Situação no Sankhya: linha do tempo no pedido", () => {
  it.each(TIMELINE_CODES.map((code, index) => [code, index] as const))("%s: only that step is current, earlier ones are done, later ones pending", async (code, index) => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage(code))) });
    const region = await panel();
    expect(within(region).getByText(`Situação no Sankhya: ${ORDER_STAGE_LABELS[code]}`)).toBeInTheDocument();
    const steps = within(within(region).getByRole("list", { name: "Etapas no Sankhya" })).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    steps.forEach((step, i) => {
      expect(step).toHaveTextContent(TIMELINE_LABELS[i] as string);
      if (i === index) {
        expect(step).toHaveAttribute("aria-current", "step");
        expect(step).toHaveTextContent("(etapa atual)");
      } else {
        expect(step).not.toHaveAttribute("aria-current");
        expect(step).toHaveTextContent(i < index ? "(concluído)" : "(pendente)");
      }
    });
    expect(within(region).getAllByText(/\(etapa atual\)/)).toHaveLength(1);
  });

  it("shows the pending sector next to the stage, and 'Atualizado em' from checkedAt in São Paulo time", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("financial_check", { pendingSector: "Financeiro" }))) });
    const region = await panel();
    expect(within(region).getByText(/Situação no Sankhya: Conferência financeira · Financeiro/)).toBeInTheDocument();
    expect(within(region).getByText(/atualizado em 12:30/)).toBeInTheDocument();
  });

  it("falls back to updatedAt when checkedAt is absent", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("received", { checkedAt: undefined }))) });
    expect(await within(await panel()).findByText(/atualizado em 11:00/)).toBeInTheDocument();
  });

  it("shows 'Pedido nº' and 'Nota fiscal nº' only when the server sends them", async () => {
    const { unmount } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("in_dispatch"))) });
    let region = await panel();
    expect(within(region).queryByText(/Pedido nº/)).toBeNull();
    expect(within(region).queryByText(/Nota fiscal nº/)).toBeNull();
    unmount();

    const second = renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("in_dispatch", { nunota: 5001 }))) });
    region = await panel();
    expect(within(region).getByText("Pedido nº 5001")).toBeInTheDocument();
    expect(within(region).queryByText(/Nota fiscal nº/)).toBeNull();
    second.unmount();

    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("invoiced", { nunota: 5001, invoiceNumber: 777 }))) });
    region = await panel();
    expect(within(region).getByText("Pedido nº 5001")).toBeInTheDocument();
    expect(within(region).getByText("Nota fiscal nº 777")).toBeInTheDocument();
  });

  it("a quotation shows 'Orçamento no Sankhya' and its number, with no timeline", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("quotation", { nunota: 4321 }))) });
    const region = await panel();
    expect(within(region).getByText("Situação no Sankhya: Orçamento no Sankhya")).toBeInTheDocument();
    expect(within(region).getByText("Nº 4321")).toBeInTheDocument();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).queryByText(/Pedido nº/)).toBeNull();
  });

  it.each(["sent_to_force", "send_error"] as const)("%s: shows the Force-side label and no timeline", async (code) => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage(code))) });
    const region = await panel();
    // Force-side states are not prefixed with "Situação no Sankhya:".
    expect(within(region).getByText(ORDER_STAGE_LABELS[code])).toBeInTheDocument();
    expect(within(region).queryByText(/^Situação no Sankhya:/)).toBeNull();
    expect(within(region).queryByRole("list")).toBeNull();
  });

  it("barred: shows Barrado in the Sankhya situation without a current timeline step", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("barred"))) });
    const region = await panel();
    expect(within(region).getByText("Situação no Sankhya: Barrado")).toBeInTheDocument();
    expect(within(region).queryByText(/\(etapa atual\)/)).toBeNull();
  });

  it("erpStage null or absent: no panel, and the old status label stays", async () => {
    const { unmount } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(null)) });
    expect(await screen.findByRole("heading", { name: /^Pedido nº 5001/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Situação no Sankhya" })).toBeNull();
    expect(screen.getAllByText("Enviado ao Sankhya").length).toBeGreaterThan(0);
    unmount();

    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(undefined)) });
    expect(await screen.findByRole("heading", { name: /^Pedido nº 5001/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Situação no Sankhya" })).toBeNull();
    expect(screen.getAllByText("Enviado ao Sankhya").length).toBeGreaterThan(0);
  });

  it("a sent order shows the stage chip in the heading instead of 'Enviado ao Sankhya'", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("in_review"))) });
    const heading = await screen.findByRole("heading", { level: 1, name: /^Pedido nº 5001/ });
    expect(within(heading).getByText("Em revisão")).toBeInTheDocument();
    expect(within(heading).queryByText("Enviado ao Sankhya")).toBeNull();
  });

  it("the editor title for a draft is just Pedido and the status badge says Não enviado", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(orderDetail()) });
    await screen.findByRole("button", { name: "Confirmar pedido" });
    const heading = screen.getByRole("heading", { level: 1, name: /^Pedido(?! nº)/ });
    expect(within(heading).getByText(/^Salvo$/i)).toBeInTheDocument();
    expect(heading.textContent ?? "").not.toMatch(/rascunho|nº/i);
  });
});

describe("Situação no Sankhya: erro de leitura e nova tentativa", () => {
  const REFRESH_ID = "0190a000-0000-7000-8000-0000000000f1";
  const readError = { errorClass: "unavailable", errorCode: "sankhya_down", at: "2026-11-23T15:45:00.000Z" };
  const refreshBody = (status: "pending" | "done") => ({
    id: REFRESH_ID,
    status,
    requestedAt: "2026-11-23T16:00:00.000Z",
    startedAt: "2026-11-23T16:00:01.000Z",
    finishedAt: status === "done" ? "2026-11-23T16:00:09.000Z" : null,
    steps: [],
  });
  const withError = () => detailHandlers(sentOrder(stage("in_dispatch", { readError })));

  it("shows an alert with the time of the last known situation", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: withError() });
    const region = await panel();
    expect(within(region).getByText("Não foi possível atualizar a situação no Sankhya")).toBeInTheDocument();
    expect(within(region).getByText("Mostrando a última situação, de 12:30.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Tentar de novo" })).toBeEnabled();
  });

  it("no alert without readError", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: detailHandlers(sentOrder(stage("in_dispatch"))) });
    const region = await panel();
    expect(within(region).queryByText("Não foi possível atualizar a situação no Sankhya")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("'Tentar de novo' starts the refresh, polls it and then reloads the order", async () => {
    let polls = 0;
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: {
        ...withError(),
        "POST /sync/refresh": { body: { ...refreshBody("pending"), reused: false } },
        ["GET /sync/refresh/" + REFRESH_ID]: () => {
          polls += 1;
          return { body: refreshBody("done") };
        },
      },
    });
    const region = await panel();
    expect(callsTo(calls, "GET", "/orders/:id".replace(":id", ORDER_ID))).toHaveLength(1);
    await user.click(within(region).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/sync/refresh")).toHaveLength(1));
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    await waitFor(() => expect(callsTo(calls, "GET", `/orders/${ORDER_ID}`).length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });

  it("a refresh that cannot start says 'A atualização não foi iniciada.' and does not poll", async () => {
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: { ...withError(), "POST /sync/refresh": apiError(503, "unavailable", "Indisponível") },
    });
    const region = await panel();
    await user.click(within(region).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(region).findByText("A atualização não foi iniciada.")).toBeInTheDocument();
    expect(within(region).queryByText(/Mostrando a última situação/)).toBeNull();
    expect(calls.some((call) => call.path.startsWith("/sync/refresh/"))).toBe(false);
  });
});

describe("Situação no Sankhya: lista de pedidos", () => {
  const OTHER = "0190a000-0000-7000-8000-0000000000bb";
  const THIRD = "0190a000-0000-7000-8000-0000000000cc";
  // Behaves like the API: `stage` filters the page and `total`.
  const list = (): Handlers => ({
    "GET /orders": (request) => {
      const all = [
        orderListItem({ draftNumber: 12, status: "sent", erpNumber: 5001, erpStage: stage("in_dispatch") }),
        orderListItem({ id: OTHER, draftNumber: 13, status: "sent", erpNumber: 5002, erpStage: stage("invoiced") }),
        orderListItem({ id: THIRD, draftNumber: 14, status: "sent", erpNumber: 5003, erpStage: null }),
        orderListItem({ id: "0190a000-0000-7000-8000-0000000000dd", draftNumber: 15, customerName: "Cliente Rascunhado", status: "draft" }),
      ];
      const wanted = request.search.get("stage");
      return { body: ordersPage(wanted ? all.filter((order) => order.erpStage?.stage === wanted) : all) };
    },
    "GET /customers": { body: customersPage([customer()]) },
  });
  const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

  it("a sent order shows the stage chip instead of 'Enviado ao Sankhya'; without stage the old badge stays; a draft says 'Não enviado'", async () => {
    renderApp("/pedidos", { handlers: list() });
    await screen.findByText("Pedido nº 5001");
    const stageRow = rowOf("Pedido nº 5001");
    expect(within(stageRow).getByText("Na expedição")).toBeInTheDocument();
    expect(within(stageRow).queryByText("Enviado ao Sankhya")).toBeNull();
    expect(within(rowOf("Pedido nº 5002")).getByText("Faturado")).toBeInTheDocument();
    expect(within(rowOf("Pedido nº 5003")).getByText("Enviado ao Sankhya")).toBeInTheDocument();
    expect(within(rowOf("Cliente Rascunhado")).getByText(/^Salvo$/i)).toBeInTheDocument();
  });

  it("a stage on a non-sent order does not override the status badge", async () => {
    renderApp("/pedidos", {
      handlers: {
        ...list(),
        "GET /orders": { body: ordersPage([orderListItem({ draftNumber: 20, customerName: "Cliente Fila", status: "queued", erpStage: stage("sent_to_force") })]) },
      },
    });
    const row = (await screen.findByText("Cliente Fila")).closest("tr") as HTMLElement;
    expect(within(row).queryByText("Enviado ao Force")).toBeNull();
  });

  it("the 'Situação no Sankhya' filter offers every stage, narrows the list, keeps `stage` in the URL and shows a removable chip", async () => {
    const { user, router, calls } = renderApp("/pedidos?group=sent", { handlers: list() });
    await screen.findByText("Pedido nº 5001");
    expect(callsTo(calls, "GET", "/orders")[0]?.search.has("stage")).toBe(false);
    const select = screen.getByLabelText("Situação no Sankhya");
    const options = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["", ...SENT_ORDER_STAGES]);
    await user.selectOptions(select, "invoiced");
    await waitFor(() => expect(screen.queryByText("Pedido nº 5001")).toBeNull());
    expect(screen.getByText("Pedido nº 5002")).toBeInTheDocument();
    expect(screen.queryByText("Pedido nº 5003")).toBeNull();
    expect(router.state.location.search).toMatchObject({ stage: "invoiced" });
    expect(callsTo(calls, "GET", "/orders").at(-1)?.search.get("stage")).toBe("invoiced");
    const chip = screen.getByRole("button", { name: "Remover filtro: Sankhya: Faturado" });
    await user.click(chip);
    expect(await screen.findByText("Pedido nº 5001")).toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty("stage");
  });

  it("a stage with no orders shows the empty state with 'Limpar filtros'", async () => {
    const { user, router } = renderApp("/pedidos?stage=send_error", { handlers: list() });
    expect(await screen.findByText("Nenhuma venda encontrada com esses filtros.")).toBeInTheDocument();
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Limpar filtros" }));
    expect(await screen.findByText("Pedido nº 5001")).toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty("stage");
  });

  it("an invalid `stage` in the URL is ignored (all orders are listed)", async () => {
    renderApp("/pedidos?stage=bogus", { handlers: list() });
    expect(await screen.findByText("Pedido nº 5001")).toBeInTheDocument();
    expect(screen.getByText("Pedido nº 5002")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remover filtro: Sankhya/ })).toBeNull();
  });

  it("'Atualizar dados' reloads the orders list at the end of the refresh", async () => {
    const REFRESH_ID = "0190a000-0000-7000-8000-0000000000f2";
    const body = (status: "pending" | "done") => ({
      id: REFRESH_ID,
      status,
      requestedAt: "2026-11-23T16:00:00.000Z",
      startedAt: "2026-11-23T16:00:01.000Z",
      finishedAt: status === "done" ? "2026-11-23T16:00:09.000Z" : null,
      steps: [],
    });
    const { user, calls } = renderApp("/pedidos", {
      handlers: {
        ...list(),
        "POST /sync/refresh": { body: { ...body("pending"), reused: false } },
        ["GET /sync/refresh/" + REFRESH_ID]: { body: body("done") },
      },
    });
    await screen.findByText("Pedido nº 5001");
    const before = callsTo(calls, "GET", "/orders").length;
    await openRefresh(user);
    await waitFor(() => expect(callsTo(calls, "POST", "/sync/refresh")).toHaveLength(1));
    await waitFor(() => expect(callsTo(calls, "GET", "/orders").length).toBeGreaterThan(before), { timeout: 5000 });
  });
});

describe("parseOrdersSearch: stage", () => {
  it("accepts every known stage", () => {
    for (const code of ORDER_STAGE_FILTERS) expect(parseOrdersSearch({ stage: code }).stage).toBe(code);
  });

  it("covers every stage the domain names", () => {
    expect([...ORDER_STAGE_FILTERS].sort()).toEqual(Object.keys(ORDER_STAGE_LABELS).sort());
  });

  it.each([["bogus"], [""], [7], [null], [true], [["invoiced"]], ["INVOICED"]])("drops the invalid value %j", (value) => {
    expect(parseOrdersSearch({ stage: value })).not.toHaveProperty("stage");
  });

  it("keeps the other filters when the stage is invalid", () => {
    expect(parseOrdersSearch({ stage: "x", status: "sent", search: "abc" })).toEqual({ group: "sent", status: "sent", search: "abc" });
  });
});

describe("Texto visível: sem 'rascunho'", () => {
  const SRC = join(process.cwd(), "src") + sep;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
    }
  };

  it("no non-test source under apps/web/src carries the word, except the hidden command-menu keyword and server-shaped fixtures", () => {
    walk(SRC);
    expect(files.length).toBeGreaterThan(50); // guards against scanning nothing
    const allowed = (path: string, line: string) =>
      /[\\/]test[\\/]fixtures\.ts$/.test(path) || (/command-menu\.tsx$/.test(path) && /keywords:/.test(line));
    const offenders: string[] = [];
    for (const path of files) {
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/rascunho/i.test(line) && !allowed(path, line)) offenders.push(`${path.slice(SRC.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the orders list renders without the word", async () => {
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([orderListItem()]) }, "GET /customers": { body: customersPage([customer()]) } } });
    await screen.findAllByText("Comercial Alfa Ltda");
    expect(document.body.textContent ?? "").not.toMatch(/rascunho/i);
    expect(screen.getAllByText(/^Salvo$/i).length).toBeGreaterThan(0);
  });
});
