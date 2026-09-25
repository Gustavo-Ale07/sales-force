import { TopProgress } from "@salesforce/ui";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

/** Top-of-window bar while the app fetches data, saves something or navigates to a page that is still loading. */
export function GlobalActivity() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const navigating = useRouterState({ select: (state) => state.isLoading });
  return <TopProgress active={fetching > 0 || mutating > 0 || navigating} />;
}
