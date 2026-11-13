import { clearReferenceCache, countUnsentLocalWork, wipeLocalDatabase, type SqlDatabase } from "@salesforce/mobile-db";
import type { ApiClient } from "../data/api";
import type { Repositories } from "../data/ports";
import { account } from "../test-doubles";
import { createOfflineServices } from "./services";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  countUnsentLocalWork: jest.fn(),
  clearReferenceCache: jest.fn(async () => undefined),
  wipeLocalDatabase: jest.fn(async () => undefined),
}));

const unsent = countUnsentLocalWork as jest.Mock;
const clear = clearReferenceCache as jest.Mock;
const wipe = wipeLocalDatabase as jest.Mock;

function services() {
  return createOfflineServices({ db: {} as SqlDatabase, api: {} as ApiClient, remote: {} as Repositories });
}

beforeEach(() => jest.clearAllMocks());

describe("sign-out and the local cache", () => {
  it("nothing unsent: the cache is cleared", async () => {
    unsent.mockResolvedValue(0);
    expect(await services().endSession(account.id)).toEqual({ cleared: true, unsent: 0 });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("something unsent: the cache and the work stay (isolated per account) and the count is reported", async () => {
    unsent.mockResolvedValue(3);
    expect(await services().endSession(account.id)).toEqual({ cleared: false, unsent: 3 });
    expect(clear).not.toHaveBeenCalled();
    expect(unsent).toHaveBeenCalledWith(expect.anything(), account.id);
  });

  it("a failed count never clears (unknown is treated as pending)", async () => {
    unsent.mockRejectedValue(new Error("db"));
    await expect(services().endSession(account.id)).resolves.toEqual({ cleared: false, unsent: null });
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("revocation or deactivation (wipe)", () => {
  it("wipeAll deletes the whole local database", async () => {
    await services().wipeAll();
    expect(wipe).toHaveBeenCalledTimes(1);
  });
});
