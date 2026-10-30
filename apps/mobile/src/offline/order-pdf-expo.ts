import PLAC_LOGO from "../../assets/brand/plac-logo.png";
import type { OrderPdfPort } from "./order-pdf";

/**
 * Native adapter (expo-print renders the HTML to PDF, expo-sharing opens the OS share sheet: WhatsApp, e-mail...). Native
 * modules are loaded on first use so importing the app never needs them. Device-only: unit tests use the port double.
 * The PLAC logo is read from the bundled asset and embedded as a data URI, so it renders offline. The generated PDF is
 * temporary: deleted right after the share sheet closes (it is never kept or exported in bulk).
 */
export function createExpoOrderPdf(): OrderPdfPort {
  let cachedLogo: string | null | undefined;
  return {
    async logoDataUri() {
      if (cachedLogo !== undefined) return cachedLogo;
      try {
        const { Asset } = await import("expo-asset");
        const { File } = await import("expo-file-system");
        const asset = Asset.fromModule(PLAC_LOGO);
        await asset.downloadAsync();
        cachedLogo = asset.localUri === null ? null : `data:image/png;base64,${await new File(asset.localUri).base64()}`;
      } catch {
        cachedLogo = null; // the template falls back to the PLAC wordmark
      }
      return cachedLogo;
    },
    async sharePdf(html, fileName) {
      const Print = await import("expo-print");
      const Sharing = await import("expo-sharing");
      const { File } = await import("expo-file-system");
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing_unavailable");
      // A4 in points (72 dpi).
      const printed = await Print.printToFileAsync({ html, width: 595, height: 842 });
      try {
        await Sharing.shareAsync(printed.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: fileName });
      } finally {
        try {
          new File(printed.uri).delete();
        } catch {
          // best effort: the cache directory is purgeable by the OS
        }
      }
    },
  };
}
