import { useNavigate, useSearch } from "@tanstack/react-router";
import { parseReleaseQueueSearch } from "../lib/route-search";
import { ReleaseQueuePage } from "./release-queue";

export function ReleaseQueueRoute() {
  const navigate = useNavigate();
  const params = parseReleaseQueueSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return <ReleaseQueuePage params={params} onSearchChange={(next) => void navigate({ to: "/aguardando-liberacao", search: next, replace: true })} />;
}
