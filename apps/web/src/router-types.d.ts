import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Breadcrumb / document-title label for this route segment. */
    crumb?: string | ((params: Record<string, string>) => string);
  }
}
