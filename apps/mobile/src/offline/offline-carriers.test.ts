import { getMeta, isCacheReady, setMeta, type OfflineEnv, type SqlDatabase } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import type { Repositories } from "../data/ports";
import { fakeOrders } from "../test-doubles";
import { createOfflineFirstRepositories } from "./offline-repositories";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  isCacheReady: jest.fn(),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
}));

const ready = isCacheReady as jest.MockedFunction<typeof isCacheReady>;
const read = getMeta as jest.MockedFunction<typeof getMeta>;
const write = setMeta as jest.MockedFunction<typeof setMeta>;
const env = { now: () => new Date("2026-10-30T12:00:00Z"), newId: () => "x" } as unknown as OfflineEnv;
const list = [{ code: 7, name: "Rápido" }];

function repos(listCarriers: () => Promise<readonly { code: number; name: string }[]>) {
  const remote = { customers: {}, products: {}, orders: fakeOrders({ listCarriers }) } as unknown as Repositories;
  return createOfflineFirstRepositories({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", remote }).orders;
}

beforeEach(() => {
  ready.mockReset().mockResolvedValue(true);
  read.mockReset().mockResolvedValue(null);
  write.mockReset().mockResolvedValue(undefined);
});

describe("carrier list, offline-first (D-C)", () => {
  it("returns the live list and remembers it", async () => {
    expect(await repos(async () => list).listCarriers()).toEqual(list);
    expect(write).toHaveBeenCalledWith(expect.anything(), "cache.carriers", JSON.stringify(list), expect.any(String));
  });

  it("answers from the stored list when there is no connection", async () => {
    read.mockResolvedValue(JSON.stringify(list));
    expect(await repos(async () => { throw new ApiRequestError({ status: 0, message: "x" }); }).listCarriers()).toEqual(list);
  });

  it("is an empty list, not an error, when offline with nothing stored", async () => {
    expect(await repos(async () => { throw new ApiRequestError({ status: 0, message: "x" }); }).listCarriers()).toEqual([]);
    ready.mockResolvedValue(false);
    expect(await repos(async () => { throw new ApiRequestError({ status: 0, message: "x" }); }).listCarriers()).toEqual([]);
  });

  it("does not hide a server refusal behind the stored list", async () => {
    read.mockResolvedValue(JSON.stringify(list));
    await expect(repos(async () => { throw new ApiRequestError({ status: 403, message: "x" }); }).listCarriers()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
