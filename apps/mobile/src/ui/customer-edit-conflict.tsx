import { useEffect, useRef } from "react";
import type { CustomerEditRecord } from "@salesforce/mobile-db";
import type { PendingCustomersPort } from "../offline/pending-customers";
import { useAppModal } from "./app-modal";

const dash = (value: string) => (value.trim() === "" ? "(vazio)" : value);

/** Both versions side by side: what the seller typed here and what the ERP has now (only the fields the seller changed). */
export function describeEditConflict(edit: CustomerEditRecord): string {
  const server = edit.serverVersion;
  const lines: string[] = [];
  if (edit.changes.phone !== undefined) lines.push(`Telefone\nSua alteração: ${dash(edit.changes.phone)}\nNo Sankhya: ${dash(server?.phone ?? "")}`);
  if (edit.changes.email !== undefined) lines.push(`E-mail\nSua alteração: ${dash(edit.changes.email)}\nNo Sankhya: ${dash(server?.email ?? "")}`);
  if (edit.changes.notes !== undefined) lines.push(`Observações\nSua alteração: ${dash(edit.changes.notes)}`);
  return lines.join("\n\n");
}

/**
 * Pops up, one at a time, an edit that met a customer changed in the ERP meanwhile (or was refused). The seller keeps their version
 * (sent again over the current one) or the ERP's (the local edit is dropped). Nothing is sent or lost without that choice.
 */
export function CustomerEditConflictWatcher({ port, tick }: { readonly port: PendingCustomersPort | null; readonly tick: unknown }) {
  const modal = useAppModal();
  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (port?.editsNeedingAttention === undefined) return undefined;
    let current = true;
    void port
      .editsNeedingAttention()
      .then((edits) => {
        if (!current) return;
        const next = edits.find((edit) => !shown.current.has(`${edit.clientRequestId}:${edit.state}`));
        if (next === undefined) return;
        shown.current.add(`${next.clientRequestId}:${next.state}`);
        if (next.state === "conflict") {
          modal.show({
            variant: "confirm",
            title: `${next.customerName}: alterado no Sankhya`,
            message: describeEditConflict(next),
            buttons: [
              { label: "Manter a minha", role: "primary", onPress: () => void port.resolveEditConflict?.(next.clientRequestId, "mine") },
              { label: "Manter a do Sankhya", role: "secondary", onPress: () => void port.resolveEditConflict?.(next.clientRequestId, "theirs") },
            ],
          });
        } else {
          modal.show({
            variant: "error",
            title: `${next.customerName}: alteração recusada`,
            message: next.lastError ?? "O Sankhya recusou a alteração.",
            buttons: [{ label: "Descartar alteração", role: "primary", onPress: () => void port.discardEdit?.(next.clientRequestId) }, { label: "Fechar", role: "cancel" }],
          });
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [port, tick, modal]);
  return null;
}
