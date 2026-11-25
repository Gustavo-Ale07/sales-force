import { Button, Dialog, DialogClose, DialogContent, FieldError, FormField, Input, Spinner } from "@salesforce/ui";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { productQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { applyDiscount, discountProblemMessages, parseDiscountInput, type EditorLine } from "../lib/order-draft";

/** Percentage field with a "%" at its end. */
function PercentInput({ value, onChange, onEnter, label, invalid, describedBy }: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <Input
      size="md"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      value={value}
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      endSlot={<span className="pointer-events-none pr-2 text-xs text-fg-muted" aria-hidden="true">%</span>}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || !onEnter) return;
        event.preventDefault();
        onEnter();
      }}
    />
  );
}

/** What the editor stores for a validated percentage: "0" means no discount (an empty field). */
function storedText(value: string): string {
  return value === "0" ? "" : value.replace(".", ",");
}

/** The content stays mounted while the dialog fades out, then is dropped so the next opening starts from scratch. */
function useMountedWhileOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      const frame = setTimeout(() => setMounted(true), 0);
      return () => clearTimeout(frame);
    }
    const timer = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(timer);
  }, [open]);
  return open || mounted;
}

const ALL_ITEMS = "__all__";
const NO_GROUP = "none";

export interface BulkDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly EditorLine[];
  /** "Desconto por grupo": no "Todos os itens" row; nothing is chosen until the seller picks a group of the cart. */
  groupsOnly?: boolean;
  /** Replaces the lines with the ones that carry the discount. */
  onApply: (lines: EditorLine[], applied: number, discountText: string) => void;
}

interface GroupRow {
  key: string;
  name: string;
  count: number;
}

/**
 * The one bulk discount dialog, same as the app's sheet: "Desconto em lote" for every item or for one group of the cart,
 * one percentage, one target; the button carries the number of affected items. Lines loaded from a saved order do not know
 * their group: it is looked up (from the catalog) only while the dialog is open. Items without price never receive a discount.
 */
export function BulkDiscountDialog({ open, onOpenChange, lines, groupsOnly = false, onApply }: BulkDiscountDialogProps) {
  const mounted = useMountedWhileOpen(open);
  // Each opening starts from scratch, even when it happens before the fade-out of the previous one ends.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((value) => value + 1);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mounted ? <BulkDiscountContent key={session} open={open} lines={lines} groupsOnly={groupsOnly} onApply={onApply} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function BulkDiscountContent({ open, lines, groupsOnly = false, onApply, onOpenChange }: BulkDiscountDialogProps) {
  const api = useApi();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(groupsOnly ? "" : ALL_ITEMS);

  const unknown = lines.filter((line) => line.group === undefined);
  const lookups = useQueries({
    queries: unknown.map((line) => ({ ...productQueryOptions(api, line.productCode), staleTime: 5 * 60_000, retry: false, enabled: open })),
  });
  const looked = new Map<number, { code: number | null; name: string | null }>();
  unknown.forEach((line, index) => {
    const data = lookups[index]?.data;
    if (data) looked.set(line.productCode, { code: data.groupCode, name: data.groupName });
  });
  const loading = open && lookups.some((query) => query.isPending);

  const keyOf = (line: EditorLine): string | null => {
    const group = line.group ?? looked.get(line.productCode);
    return group === undefined ? null : group.code === null ? NO_GROUP : String(group.code);
  };

  const rows = useMemo(() => {
    const byKey = new Map<string, GroupRow>();
    for (const line of lines) {
      const group = line.group ?? looked.get(line.productCode);
      if (group === undefined) continue;
      const key = group.code === null ? NO_GROUP : String(group.code);
      const row = byKey.get(key) ?? { key, name: group.code === null ? "Sem grupo" : (group.name ?? `Grupo ${group.code}`), count: 0 };
      row.count += 1;
      byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    // `looked` is rebuilt on every render from the lookups; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, lookups]);

  const match = (line: EditorLine): boolean => target === ALL_ITEMS || (target !== "" && keyOf(line) === target);
  const affected = lines.filter((line) => match(line) && line.price.state !== "none").length;
  const parsed = parseDiscountInput(text);
  const empty = text.trim() === "";
  const problem = !empty && !parsed.ok ? discountProblemMessages[parsed.problem] : null;
  const canApply = !loading && !empty && parsed.ok && affected > 0;

  const apply = () => {
    if (!canApply || !parsed.ok) return;
    const discountText = storedText(parsed.value);
    const result = applyDiscount(lines, discountText, match);
    onApply(result.lines, result.applied, discountText);
    onOpenChange(false);
  };

  const targets: GroupRow[] = [...(groupsOnly ? [] : [{ key: ALL_ITEMS, name: "Todos os itens", count: lines.length }]), ...rows];

  return (
    <DialogContent
      title={groupsOnly ? "Desconto por grupo" : "Desconto em lote"}
      className="max-w-md"
      footer={
        <>
          <span className="flex-1" />
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant="primary" disabled={!canApply} aria-label="Aplicar desconto" onClick={apply}>
            Aplicar · {affected === 1 ? "1 item afetado" : `${affected} itens afetados`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {loading ? (
          <p className="m-0 flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner /> Identificando os grupos dos itens…
          </p>
        ) : (
          <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0" role="radiogroup" aria-label="Aplicar em">
            {targets.map((row) => (
              <li key={row.key}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:font-medium">
                  <input type="radio" name="discount-target" value={row.key} checked={target === row.key} onChange={() => setTarget(row.key)} />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="text-fg-muted">{row.count}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <FormField label="Desconto (%)">
          {(controlProps) => (
            <div className="flex flex-col gap-1">
              <PercentInput
                {...controlProps}
                label="Desconto (%)"
                value={text}
                invalid={problem !== null}
                describedBy={problem ? "bulk-discount-error" : undefined}
                onChange={setText}
                onEnter={apply}
              />
              {problem ? <FieldError id="bulk-discount-error">{problem}</FieldError> : null}
            </div>
          )}
        </FormField>
      </div>
    </DialogContent>
  );
}
