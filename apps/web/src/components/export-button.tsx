import { Button, Select, toast } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { downloadFile } from "../lib/api-imports";
import { describeApiError } from "../lib/error-message";

/** Profiles the server lets export (central policy); the button is only a convenience, the route still refuses everyone else. */
const EXPORT_ROLES: readonly string[] = ["admin", "manager"];

export type ExportResource = "customers" | "orders" | "products";

export interface ExportButtonProps {
  resource: ExportResource;
  /** The filters of the list on screen, sent as they are (the server applies its own scope). */
  query: Record<string, string | number | undefined>;
}

/** CSV or XLSX of the list on screen, for the internal profiles only. */
export function ExportButton({ resource, query }: ExportButtonProps) {
  const { authClient } = useAppServices();
  const session = useQuery(sessionQueryOptions(authClient));
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);
  if (session.data === undefined || session.data === null || !EXPORT_ROLES.includes(session.data.role)) return null;

  const run = async () => {
    setBusy(true);
    try {
      await downloadFile(`/exports/${resource}`, { ...query, format }, `${resource}.${format}`);
    } catch (error) {
      toast({ title: describeApiError(error, "Não foi possível exportar").description, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select size="md" aria-label="Formato da exportação" value={format} onChange={(event) => setFormat(event.target.value === "csv" ? "csv" : "xlsx")}>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV</option>
      </Select>
      <Button variant="secondary" leftIcon={<Download size={16} aria-hidden="true" />} loading={busy} onClick={() => void run()}>
        Exportar
      </Button>
    </div>
  );
}
