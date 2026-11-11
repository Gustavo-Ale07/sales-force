import { useQuery } from "@tanstack/react-query";
import type { PublishedState } from "../components/downloads/cta";
import { Benefits, Experimental, Hero, HowTo, PhoneSection, SiteFooter, TopBar, WebSection } from "../components/downloads/sections";
import { loadDownloads } from "../lib/downloads";

/**
 * The parsed `DownloadItem` carries no `environment` field (and the lib does not change), so the "Versão de testes"
 * notice is driven by the newest item's `channel`: "staging" or "sandbox" means a test build.
 */
const TEST_CHANNELS: ReadonlySet<string> = new Set(["staging", "sandbox"]);

/**
 * "Aplicativo": the download centre (public on purpose, so a phone can open it without signing in). The list comes
 * from `downloads.json` (configuration published with the files); nothing here is a literal. No published build
 * (still loading, 404, empty list) renders the same page with the Android action disabled; only a real failure to
 * read the index shows a discreet notice with "Tentar de novo".
 */
export function DownloadsPage() {
  const query = useQuery({ queryKey: ["downloads-index"], queryFn: () => loadDownloads(), retry: false });
  const newest = query.data?.[0] ?? null;
  const state: PublishedState = query.isPending
    ? { kind: "loading" }
    : query.isError
      ? { kind: "error" }
      : newest
        ? { kind: "ready", item: newest }
        : { kind: "none" };

  return (
    <div className="dl-root min-h-screen bg-[#02040f] text-white">
      <TopBar />
      <main id="conteudo" aria-busy={query.isPending}>
        <Hero state={state} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        <PhoneSection state={state} />
        <WebSection />
        <Benefits />
        {newest && TEST_CHANNELS.has(newest.channel) ? <Experimental /> : null}
        <HowTo item={newest} />
      </main>
      <SiteFooter item={newest} />
    </div>
  );
}
