/**
 * Prints an HTML document through a hidden, sandboxed iframe (the browser's print dialog offers "Salvar como PDF").
 * Nothing is sent anywhere: the document is built in the browser from data the API already returned.
 */
export function printHtml(html: string, doc: Document = document): void {
  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // allow-modals is needed for print(); scripts of the document do not exist and are not allowed.
  frame.setAttribute("sandbox", "allow-modals allow-same-origin");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const cleanup = () => frame.remove();
  frame.addEventListener(
    "load",
    () => {
      const view = frame.contentWindow;
      if (!view) return cleanup();
      view.addEventListener("afterprint", cleanup);
      view.focus();
      view.print();
      // Some browsers never fire afterprint: do not leak the frame.
      setTimeout(cleanup, 120_000);
    },
    { once: true },
  );
  frame.srcdoc = html;
  doc.body.appendChild(frame);
}
