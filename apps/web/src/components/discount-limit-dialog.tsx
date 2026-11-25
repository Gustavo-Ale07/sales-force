import { Button, Dialog, DialogContent } from "@salesforce/ui";
import type { AboveLimitEntry } from "../lib/discount-limit";

export const DISCOUNT_LIMIT_QUESTION = "Esse desconto é acima do liberado. Tem certeza que deseja utilizar essa %?";

/** What is waiting for the seller's answer: one item, or a bulk/group operation with its summary. */
export type DiscountLimitPrompt = { kind: "item" } | { kind: "bulk"; within: string[]; above: AboveLimitEntry[] };

export interface DiscountLimitDialogProps {
  prompt: DiscountLimitPrompt | null;
  onYes: () => void;
  onNo: () => void;
}

/** The only discount-above-limit confirmation (same words and order as the app: the question, "Acima do limite", "Dentro do limite", Sim, Não). Closing it (Esc, X) counts as "Não". */
export function DiscountLimitDialog({ prompt, onYes, onNo }: DiscountLimitDialogProps) {
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => (open ? undefined : onNo())}>
      {prompt ? (
        <DialogContent
          title={DISCOUNT_LIMIT_QUESTION}
          className="max-w-md"
          footer={
            <>
              <span className="flex-1" />
              <Button variant="primary" onClick={onYes}>
                Sim
              </Button>
              <Button variant="secondary" onClick={onNo}>
                Não
              </Button>
            </>
          }
        >
          {prompt.kind === "bulk" ? (
            <div className="flex flex-col gap-2 text-sm" data-testid="discount-limit-list">
              <h3 className="m-0 text-sm font-semibold">{`Acima do limite (${prompt.above.length})`}</h3>
              <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
                {prompt.above.map((entry, index) => (
                  <li key={`${entry.name}-${index}`}>{`${entry.name}: máx. ${entry.limit}%, digitado ${entry.typed}%`}</li>
                ))}
              </ul>
              <h3 className="m-0 text-sm font-semibold">{`Dentro do limite (${prompt.within.length})`}</h3>
              <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
                {prompt.within.length === 0 ? <li>Nenhum item.</li> : prompt.within.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
              </ul>
            </div>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
