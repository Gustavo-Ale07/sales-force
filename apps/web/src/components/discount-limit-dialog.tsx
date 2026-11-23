import { Button, Dialog, DialogContent } from "@salesforce/ui";
import type { AboveLimitEntry } from "../lib/discount-limit";

export const DISCOUNT_LIMIT_QUESTION = "Esse desconto é acima do liberado. Tem certeza que deseja utilizar essa %?";

/** What is waiting for the seller's answer: one item, or a bulk/group operation with its summary. */
export type DiscountLimitPrompt = { kind: "item" } | { kind: "bulk"; within: number; above: AboveLimitEntry[] };

export interface DiscountLimitDialogProps {
  prompt: DiscountLimitPrompt | null;
  onYes: () => void;
  onNo: () => void;
}

/** The only discount-above-limit confirmation. Closing it (Esc, X) counts as "Não". */
export function DiscountLimitDialog({ prompt, onYes, onNo }: DiscountLimitDialogProps) {
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => (open ? undefined : onNo())}>
      {prompt ? (
        <DialogContent
          title="Desconto acima do liberado"
          description={DISCOUNT_LIMIT_QUESTION}
          className="max-w-md"
          footer={
            <>
              <span className="flex-1" />
              <Button variant="secondary" onClick={onNo}>
                Não
              </Button>
              <Button variant="primary" onClick={onYes}>
                Sim
              </Button>
            </>
          }
        >
          {prompt.kind === "bulk" ? (
            <details className="text-sm" data-testid="discount-limit-list">
              <summary className="cursor-pointer text-fg-muted">
                {prompt.within === 1 ? "1 item dentro do limite" : `${prompt.within} itens dentro do limite`}
                {" · "}
                {prompt.above.length === 1 ? "1 item acima" : `${prompt.above.length} itens acima`}
              </summary>
              <ul className="m-0 mt-2 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0">
                {prompt.above.map((entry, index) => (
                  <li key={`${entry.name}-${index}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{entry.name}</span>
                    <span className="shrink-0 text-fg-muted">
                      limite {entry.limit}% · digitado {entry.typed}%
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
