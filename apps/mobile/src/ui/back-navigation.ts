import type { MainTab } from "./bottom-nav";

/** Second press of Back on the home screen counts only inside this window; after it the hint shows again. */
export const EXIT_WINDOW_MS = 2000;

/** What is on screen that can take the Back press, in the order it is asked (top of the stack first). */
export interface BackState {
  /** A full-screen layer above the tabs: the sync progress screen or the retained-orders screen. */
  readonly overlay: "none" | "sync" | "quarantine";
  readonly tab: MainTab;
  /** The order wizard is open on the Vendas tab (any step, including its final screen). */
  readonly wizardOpen: boolean;
  /** A sale's detail is open inside Minhas vendas. */
  readonly saleDetailOpen: boolean;
  /** A customer's sheet is open inside Clientes. */
  readonly customerDetailOpen: boolean;
  /** When the "tap again to exit" hint was shown, or null. */
  readonly exitArmedAt: number | null;
  readonly now: number;
}

export type BackAction =
  /** Safe to ignore: the sync screen cannot be left with Back (its own "Cancelar sincronização" button is the way). */
  | { readonly type: "ignore" }
  | { readonly type: "close_quarantine" }
  /** The wizard goes back one step; on its first step it leaves, asking "Descartar o pedido?" once when there is unsaved content (an empty order leaves with no question). */
  | { readonly type: "wizard_back" }
  | { readonly type: "close_customer_detail" }
  | { readonly type: "close_sale_detail" }
  | { readonly type: "go_home" }
  | { readonly type: "arm_exit" }
  | { readonly type: "exit_app" };

/**
 * The single place that decides what Android Back does. Order: modal/popup (the platform closes those before this runs, they are
 * native windows) > full-screen overlay > order wizard > inner screen > tab root (goes to Início) > Início (press twice to exit).
 */
export function resolveBack(state: BackState): BackAction {
  if (state.overlay === "sync") return { type: "ignore" };
  if (state.overlay === "quarantine") return { type: "close_quarantine" };
  if (state.tab === "sales" && state.wizardOpen) return { type: "wizard_back" };
  if (state.tab === "customers" && state.customerDetailOpen) return { type: "close_customer_detail" };
  if (state.tab === "sales" && state.saleDetailOpen) return { type: "close_sale_detail" };
  if (state.tab !== "home") return { type: "go_home" };
  if (state.exitArmedAt !== null && state.now - state.exitArmedAt <= EXIT_WINDOW_MS) return { type: "exit_app" };
  return { type: "arm_exit" };
}
