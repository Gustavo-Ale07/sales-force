import { Button, Dialog, DialogClose, DialogContent, FieldError, FormField, Input, Money, Spinner } from "@salesforce/ui";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { productQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { applyDiscount, discountProblemMessages, parseDiscountInput, previewDraft, type EditorLine } from "../lib/order-draft";

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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface MassDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly EditorLine[];
  /** Replaces the lines with the ones that carry the discount. */
  onApply: (lines: EditorLine[], applied: number, discountText: string) => void;
}

/** The same percentage on every item of the cart that has a price. Replaces discounts already typed. */
export function MassDiscountDialog({ open, onOpenChange, lines, onApply }: MassDiscountDialogProps) {
  const mounted = useMountedWhileOpen(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mounted ? <MassDiscountContent lines={lines} onApply={onApply} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function MassDiscountContent({ lines, onApply, onOpenChange }: Pick<MassDiscountDialogProps, "lines" | "onApply" | "onOpenChange">) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  const parsed = parseDiscountInput(text);
  const problem = touched && !parsed.ok ? discountProblemMessages[parsed.problem] : null;
  const priced = lines.filter((line) => line.price.state !== "none").length;
  const withoutPrice = lines.length - priced;
  const after = useMemo(() => {
    if (!parsed.ok) return null;
    return previewDraft(applyDiscount(lines, storedText(parsed.value), () => true).lines).totals.estimatedTotal;
  }, [lines, parsed]);

  const apply = (discountText: string) => {
    const result = applyDiscount(lines, discountText, () => true);
    onApply(result.lines, result.applied, discountText);
    onOpenChange(false);
  };
  const submit = () => {
    setTouched(true);
    if (parsed.ok) apply(storedText(parsed.value));
  };

  return (
    <>
      <DialogContent
        title="Desconto em massa"
        description="O mesmo percentual em todos os itens do carrinho. Substitui os descontos já informados."
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => apply("")}>
              Remover descontos
            </Button>
            <span className="flex-1" />
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={submit}>
              Aplicar desconto
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormField label="Desconto (%)" hint="Até 99,99, com no máximo 2 casas decimais.">
            {(controlProps) => (
              <div className="flex flex-col gap-1">
                <PercentInput
                  {...controlProps}
                  label="Desconto em massa (%)"
                  value={text}
                  invalid={problem !== null}
                  describedBy={problem ? "mass-discount-error" : undefined}
                  onChange={(value) => {
                    setText(value);
                    setTouched(true);
                  }}
                  onEnter={submit}
                />
                {problem ? <FieldError id="mass-discount-error">{problem}</FieldError> : null}
              </div>
            )}
          </FormField>
          <p className="m-0 text-sm text-fg-muted" aria-live="polite">
            {plural(priced, "item recebe", "itens recebem")} o desconto.
            {withoutPrice > 0 ? ` ${plural(withoutPrice, "item sem preço fica", "itens sem preço ficam")} de fora.` : ""}
          </p>
          {after !== null ? (
            <p className="m-0 text-sm" aria-live="polite">
              <span className="text-fg-muted">Total estimado depois do desconto: </span>
              <strong>
                <Money value={after} />
              </strong>
            </p>
          ) : null}
        </div>
      </DialogContent>
    </>
  );
}

export interface GroupDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly EditorLine[];
  onApply: (lines: EditorLine[], applied: number) => void;
}

interface GroupRow {
  key: string;
  name: string;
  count: number;
}

const NO_GROUP = "none";

/**
 * A percentage per product group, for the items of the cart that belong to it. Lines loaded from a saved order do
 * not know their group: it is looked up (from the catalog) only while this dialog is open. A group left empty is not touched.
 */
export function GroupDiscountDialog({ open, onOpenChange, lines, onApply }: GroupDiscountDialogProps) {
  const mounted = useMountedWhileOpen(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mounted ? <GroupDiscountContent open={open} lines={lines} onApply={onApply} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function GroupDiscountContent({ open, lines, onApply, onOpenChange }: GroupDiscountDialogProps) {
  const api = useApi();
  const [values, setValues] = useState<Record<string, string>>({});

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
  const failed = lookups.some((query) => query.isError);

  const groupOf = (line: EditorLine): { code: number | null; name: string | null } | undefined => line.group ?? looked.get(line.productCode);
  const keyOf = (line: EditorLine): string | null => {
    const group = groupOf(line);
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

  const entries = rows.map((row) => ({ row, text: values[row.key] ?? "" }));
  const filled = entries.filter(({ text }) => text.trim() !== "");
  const problems = new Map(filled.flatMap(({ row, text }) => {
    const parsed = parseDiscountInput(text);
    return parsed.ok ? [] : [[row.key, discountProblemMessages[parsed.problem]] as const];
  }));
  const canApply = !loading && filled.length > 0 && problems.size === 0;

  const apply = () => {
    if (!canApply) return;
    let next = [...lines];
    let applied = 0;
    for (const { row, text } of filled) {
      const parsed = parseDiscountInput(text);
      if (!parsed.ok) return;
      const result = applyDiscount(next, storedText(parsed.value), (line) => keyOf(line) === row.key);
      next = result.lines;
      applied += result.applied;
    }
    onApply(next, applied);
    onOpenChange(false);
  };

  return (
    <>
      <DialogContent
        title="Desconto por grupo"
        description="Um percentual por grupo de produtos, para os itens do carrinho que pertencem a ele. Deixe em branco o grupo que não deve mudar."
        className="max-w-lg"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Aplicar descontos
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="m-0 flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner /> Identificando os grupos dos itens…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {failed ? (
              <p className="m-0 text-xs text-danger" role="alert">
                Não foi possível identificar o grupo de alguns itens; eles ficam de fora.
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="m-0 text-sm text-fg-muted">Nenhum grupo identificado nos itens do carrinho.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Grupos do carrinho">
                {rows.map((row) => {
                  const problem = problems.get(row.key);
                  const errorId = `group-discount-error-${row.key}`;
                  return (
                    <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_120px] items-start gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{row.name}</div>
                        <div className="text-xs text-fg-muted">{plural(row.count, "item", "itens")} no carrinho</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <PercentInput
                          label={`Desconto do grupo ${row.name} (%)`}
                          value={values[row.key] ?? ""}
                          invalid={problem !== undefined}
                          describedBy={problem ? errorId : undefined}
                          onChange={(value) => setValues((current) => ({ ...current, [row.key]: value }))}
                          onEnter={apply}
                        />
                        {problem ? <FieldError id={errorId}>{problem}</FieldError> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </>
  );
}
