import { cn } from "@salesforce/ui";
import { formatSize, type DownloadItem } from "../../lib/downloads";
import { AndroidIcon } from "./art";

/** Shared pill look: buttons on this page are always fully rounded. */
export const PILL = "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full px-7 text-base font-extrabold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--dl-ink)]";
export const PILL_SOLID = `${PILL} bg-[var(--sf-cta)] text-white shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] hover:bg-[var(--sf-cta-hover)]`;
export const PILL_LIGHT = `${PILL} bg-white text-[var(--sf-fg)] hover:bg-[var(--sf-cta-weak)]`;
export const PILL_GHOST = `${PILL} border-2 border-white/80 text-white hover:bg-white/10`;
export const PILL_OFF = `${PILL} cursor-not-allowed border-2 border-white/25 bg-white/10 text-white/80`;

export type PublishedState = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; item: DownloadItem };

/**
 * The main download action. With a published build it is a same-origin link; without one (still loading, nothing
 * published yet, or the index could not be read) it is a disabled button, never an error state.
 */
export function PrimaryCta({ state, large = false, className }: { state: PublishedState; large?: boolean; className?: string }) {
  const size = large ? "min-h-16 px-9 text-lg" : "";
  if (state.kind === "ready") {
    const { item } = state;
    return (
      <span className={cn("inline-flex flex-col items-center gap-2", className)}>
        <a href={item.url} download className={cn(PILL_LIGHT, size, "w-full shadow-[0_14px_34px_-12px_rgba(0,0,0,0.65)]")}>
          <AndroidIcon className="size-6 text-[var(--sf-cta)]" />
          Baixar para Android
        </a>
        <span className="text-sm text-white/80">
          Versão {item.versionName} · {formatSize(item.sizeBytes)}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-col items-center gap-2", className)}>
      <button type="button" disabled className={cn(PILL_OFF, size, "w-full")}>
        <AndroidIcon className="size-6" />
        {state.kind === "loading" ? "Carregando…" : "Android - em breve"}
      </button>
      <span className="text-sm text-white/80">{state.kind === "loading" ? "Verificando a versão mais recente" : "iPhone também em breve"}</span>
    </span>
  );
}
