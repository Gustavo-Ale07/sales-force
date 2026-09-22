import "@tanstack/react-router";
import type { OrderNoticeState } from "./lib/order-templates";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Breadcrumb / document-title label for this route segment. */
    crumb?: string | ((params: Record<string, string>) => string);
  }

  interface HistoryState {
    /** Set when a draft was just created from a recurring template or from "Repetir último pedido": lines left out of the draft. */
    orderNotice?: OrderNoticeState;
  }
}
