import { adoptRemoteDraft, getDraft, type OfflineEnv, type OrderTransport, type SqlDatabase } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { draftRecord, orderDetail } from "../test-doubles";
import { createLocalOrdersPort } from "./local-orders";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  getDraft: jest.fn(),
  adoptRemoteDraft: jest.fn(),
}));

const mockedGetDraft = getDraft as jest.MockedFunction<typeof getDraft>;
const mockedAdopt = adoptRemoteDraft as jest.MockedFunction<typeof adoptRemoteDraft>;

const dataset = { environment: "production", datasetId: "mirror-real-001" };
const quotation = () => draftRecord({ localId: "q-1", status: "synced", remoteId: "srv-q", topCode: 1000, dataset });

function port(duplicate?: jest.Mock) {
  let counter = 0;
  const env = { newId: () => `id-${++counter}`, now: () => new Date("2026-10-30T12:00:00Z") } as unknown as OfflineEnv;
  const onChanged = jest.fn();
  return {
    onChanged,
    port: createLocalOrdersPort({
      db: {} as SqlDatabase,
      env,
      transport: {} as OrderTransport,
      ownerAccountId: "acct-1",
      onChanged,
      ...(duplicate === undefined ? {} : { duplicateAsOrder: duplicate }),
    }),
  };
}

const conflict = (reason: string, skippedLines: { lineNo: number; productCode: number; reason: string }[] = []) =>
  new ApiRequestError({ status: 409, code: "conflict", message: "x", reason, skippedLines });

beforeEach(() => {
  mockedGetDraft.mockReset();
  mockedAdopt.mockReset();
  mockedGetDraft.mockResolvedValue(quotation());
  mockedAdopt.mockResolvedValue("local-new");
});

describe("LocalOrdersPort.duplicateAsOrder (D-B)", () => {
  it("sends the quotation's own dataset, adopts the new draft and reports skipped lines", async () => {
    const duplicate = jest.fn().mockResolvedValue({ order: orderDetail({ id: "srv-new" }), skippedLines: [{ lineNo: 2, productCode: 9, reason: "no_price" }] });
    const { port: p, onChanged } = port(duplicate);
    const result = await p.duplicateAsOrder("q-1");
    expect(duplicate).toHaveBeenCalledWith("srv-q", { clientRequestId: "id-1", expectedDataset: dataset });
    expect(mockedAdopt).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ ownerAccountId: "acct-1", clientRequestId: "id-1" }));
    expect(result).toEqual({ ok: true, localId: "local-new", skippedLines: [{ lineNo: 2, productCode: 9, reason: "no_price" }] });
    expect(onChanged).toHaveBeenCalled();
  });

  it.each([
    ["not_a_quotation", /não é uma cotação/],
    ["source_cancelled", /cancelada/],
    ["order_top_not_configured", /não foi configurada/],
    ["no_usable_lines", /Nenhum item/],
  ])("shows the 409 reason %s and adopts nothing", async (reason, pattern) => {
    const { port: p } = port(jest.fn().mockRejectedValue(conflict(reason)));
    const result = await p.duplicateAsOrder("q-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toMatch(pattern);
    expect(mockedAdopt).not.toHaveBeenCalled();
  });

  it("reuses the clientRequestId after a network failure and uses a new one after a definitive refusal", async () => {
    const duplicate = jest
      .fn()
      .mockRejectedValueOnce(new ApiRequestError({ status: 0, message: "x" }))
      .mockRejectedValueOnce(conflict("source_cancelled"))
      .mockResolvedValue({ order: orderDetail({ id: "srv-new" }), skippedLines: [] });
    const { port: p } = port(duplicate);
    await p.duplicateAsOrder("q-1");
    await p.duplicateAsOrder("q-1");
    await p.duplicateAsOrder("q-1");
    expect(duplicate.mock.calls.map((call) => call[1].clientRequestId)).toEqual(["id-1", "id-1", "id-2"]);
  });

  it("refuses without calling the server when unsent, legacy, foreign or offline", async () => {
    const duplicate = jest.fn();
    const { port: p } = port(duplicate);
    mockedGetDraft.mockResolvedValueOnce(draftRecord({ localId: "q-1", status: "pending_sync", remoteId: null }));
    expect((await p.duplicateAsOrder("q-1")).ok).toBe(false);
    mockedGetDraft.mockResolvedValueOnce({ ...quotation(), dataset: null });
    expect((await p.duplicateAsOrder("q-1")).ok).toBe(false);
    mockedGetDraft.mockResolvedValueOnce({ ...quotation(), ownerAccountId: "other" });
    expect((await p.duplicateAsOrder("q-1")).ok).toBe(false);
    mockedGetDraft.mockResolvedValueOnce(null);
    expect((await p.duplicateAsOrder("q-1")).ok).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();
    const { port: offline } = port(undefined);
    const result = await offline.duplicateAsOrder("q-1");
    expect(result.ok).toBe(false);
  });
});
