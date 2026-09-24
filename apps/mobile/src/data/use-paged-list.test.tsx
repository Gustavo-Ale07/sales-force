import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Page, PageRequest } from "./ports";
import { LIST_PAGE_SIZE, usePagedList } from "./use-paged-list";
import { networkError, unauthenticatedError } from "../test-doubles";

function page(items: number[], total: number, pageNumber: number): Page<number> {
  return { items, page: pageNumber, pageSize: LIST_PAGE_SIZE, total };
}

describe("usePagedList", () => {
  it("loads the first page, then appends the next one", async () => {
    const load = jest.fn(async (request: PageRequest) =>
      request.page === 1 ? page([1, 2], 3, 1) : page([3], 3, 2),
    );
    const { result } = await renderHook(() => usePagedList(load, "", jest.fn()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(true);
    expect(load).toHaveBeenCalledWith({ search: "", page: 1, pageSize: LIST_PAGE_SIZE });

    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toEqual([1, 2, 3]));
    expect(result.current.hasMore).toBe(false);
  });

  it("restarts from page 1 on a new search", async () => {
    const load = jest.fn(async (request: PageRequest) => page(request.search === "b" ? [9] : [1], 1, 1));
    const { result, rerender } = await renderHook(({ search }: { search: string }) => usePagedList(load, search, jest.fn()), {
      initialProps: { search: "" },
    });
    await waitFor(() => expect(result.current.items).toEqual([1]));
    await rerender({ search: "b" });
    await waitFor(() => expect(result.current.items).toEqual([9]));
  });

  it("discards a slow answer that arrives after a newer request", async () => {
    const resolvers = new Map<string, (value: Page<number>) => void>();
    const load = jest.fn(
      (request: PageRequest) =>
        new Promise<Page<number>>((resolve) => {
          resolvers.set(request.search, resolve);
        }),
    );
    const { result, rerender } = await renderHook(({ search }: { search: string }) => usePagedList(load, search, jest.fn()), {
      initialProps: { search: "a" },
    });
    await rerender({ search: "b" });
    await act(async () => resolvers.get("b")?.(page([2], 1, 1)));
    await waitFor(() => expect(result.current.items).toEqual([2]));
    await act(async () => resolvers.get("a")?.(page([1], 1, 1)));
    expect(result.current.items).toEqual([2]);
  });

  it("reports a first-page failure as an error the user can retry", async () => {
    let fail = true;
    const load = jest.fn(async () => {
      if (fail) throw networkError();
      return page([1], 1, 1);
    });
    const { result } = await renderHook(() => usePagedList(load, "", jest.fn()));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("offline");
    fail = false;
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toEqual([1]);
  });

  it("keeps the rows on screen when loading more fails", async () => {
    const load = jest.fn(async (request: PageRequest) => {
      if (request.page === 2) throw networkError();
      return page([1, 2], 4, 1);
    });
    const { result } = await renderHook(() => usePagedList(load, "", jest.fn()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.status).toBe("ready");
    expect(result.current.items).toEqual([1, 2]);
  });

  it("reports an expired session instead of a list error", async () => {
    const onUnauthenticated = jest.fn();
    const load = jest.fn(async (): Promise<Page<number>> => {
      throw unauthenticatedError();
    });
    await renderHook(() => usePagedList(load, "", onUnauthenticated));
    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1));
  });
});
