import { useCallback, useEffect, useRef, useState } from "react";
import { describeDataError, type DataErrorInfo } from "./errors";
import type { Page, PageRequest } from "./ports";

export const LIST_PAGE_SIZE = 25;

export interface PagedListState<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly status: "loading" | "ready" | "error";
  readonly loadingMore: boolean;
  readonly error: DataErrorInfo | null;
  readonly hasMore: boolean;
  loadMore(): void;
  reload(): void;
}

interface Snapshot<T> {
  /** Which request (search + reload counter) produced this snapshot. */
  readonly key: string;
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly failed: boolean;
  readonly error: DataErrorInfo | null;
}

/**
 * Loads a repository list one page at a time for a search text. A new search (or `reload`) restarts from page 1;
 * an answer that arrives after a newer request was issued is discarded, so a slow response never overwrites a
 * fresher one. A 401 is reported through `onUnauthenticated` (the session is gone) instead of as a list error.
 * "Loading" is derived (no snapshot for the current request yet), never set from inside an effect.
 */
export function usePagedList<T, R extends PageRequest = PageRequest>(
  load: (request: R) => Promise<Page<T>>,
  search: string,
  onUnauthenticated: () => void,
  /** Extra request fields (filters, jump offset). A change restarts the list from page 1 like a new search. */
  extra?: Omit<R, keyof PageRequest>,
): PagedListState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const latest = useRef(0);
  const loadRef = useRef(load);
  const expiredRef = useRef(onUnauthenticated);
  const extraRef = useRef(extra);
  const extraKey = JSON.stringify(extra ?? null);
  const mountedRef = useRef(true);
  useEffect(() => {
    loadRef.current = load;
    expiredRef.current = onUnauthenticated;
    extraRef.current = extra;
  });
  // A page fetch can still be in flight when the screen unmounts (e.g. the customer or product picker is
  // swapped out, or a test moves on); without this guard its answer lands after `render()` has already committed
  // the next screen, corrupting an unrelated in-progress render (RTL/React "overlapping act()" warnings).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const key = `${reloadToken}:${search}:${extraKey}`;

  const run = useCallback(async (requestKey: string, query: string, nextPage: number, previous: Snapshot<T> | null) => {
    const ticket = ++latest.current;
    const append = previous !== null && nextPage > 1;
    try {
      const result = await loadRef.current({ ...extraRef.current, search: query, page: nextPage, pageSize: LIST_PAGE_SIZE } as R);
      if (ticket !== latest.current || !mountedRef.current) return;
      setSnapshot({
        key: requestKey,
        items: append ? [...previous.items, ...result.items] : result.items,
        total: result.total,
        page: result.page,
        failed: false,
        error: null,
      });
    } catch (failure) {
      if (ticket !== latest.current || !mountedRef.current) return;
      const info = describeDataError(failure);
      if (info.kind === "unauthenticated") {
        expiredRef.current();
        return;
      }
      // A failed "load more" keeps the rows already on screen; only a first page failure empties the list.
      setSnapshot(
        append
          ? { ...previous, error: info }
          : { key: requestKey, items: [], total: 0, page: 0, failed: true, error: info },
      );
    } finally {
      if (ticket === latest.current && mountedRef.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void run(key, search, 1, null);
  }, [key, search, run]);

  const current = snapshot !== null && snapshot.key === key ? snapshot : null;
  const items = current?.items ?? [];
  const total = current?.total ?? 0;
  const hasMore = current !== null && !current.failed && items.length < total;

  const loadMore = useCallback(() => {
    if (current === null || current.failed || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    void run(key, search, current.page + 1, current);
  }, [current, loadingMore, items.length, total, run, key, search]);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    items,
    total,
    status: current === null ? "loading" : current.failed ? "error" : "ready",
    loadingMore,
    error: current?.error ?? null,
    hasMore,
    loadMore,
    reload,
  };
}
