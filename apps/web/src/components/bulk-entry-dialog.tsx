import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  FieldError,
  FieldHint,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@salesforce/ui";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type ChangeEvent } from "react";
import { resolveProducts } from "../lib/api-mutations";
import { useApi } from "../lib/app-context";
import {
  MAX_ENTRY_BYTES,
  MAX_ORDER_ROWS,
  entryFailureMessages,
  identifiersToResolve,
  parseBulkEntry,
  planEntry,
  skipReasonMessages,
  type EntryRow,
  type PlanContext,
  type PlannedRow,
} from "../lib/bulk-entry";
import { describeApiError } from "../lib/error-message";
import type { ProductRow } from "../lib/price-types";

export interface BulkEntryItem {
  product: ProductRow;
  quantityText: string;
}

export interface BulkEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerCode: number;
  /** How many lines the order already has (an order holds at most 500). */
  existingCount: number;
  planContext: PlanContext;
  onAdd: (items: BulkEntryItem[]) => void;
}

const EXAMPLE = "2001;5\n2002;2,5\nBL-09-VM;10";

/** "Lançamento múltiplo": paste `código;quantidade` lines or read a CSV, review what each line does, then add. */
export function BulkEntryDialog({ open, onOpenChange, ...rest }: BulkEntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <BulkEntryContent onClose={() => onOpenChange(false)} {...rest} /> : null}
    </Dialog>
  );
}

interface Review {
  planned: PlannedRow[];
  skippedBeyondLimit: number;
}

function BulkEntryContent({
  onClose,
  customerCode,
  existingCount,
  planContext,
  onAdd,
}: Omit<BulkEntryDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const api = useApi();
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  const resolve = useMutation({
    mutationFn: async (rows: EntryRow[]) => {
      const identifiers = identifiersToResolve(rows);
      if (identifiers.length === 0) return [];
      const response = await resolveProducts(api, { customerCode, identifiers });
      return response.items;
    },
  });

  const check = (source: string) => {
    setInputError(null);
    setReview(null);
    const parsed = parseBulkEntry(source);
    if (!parsed.ok) {
      setInputError(entryFailureMessages[parsed.reason]);
      return;
    }
    resolve.mutate(parsed.rows, {
      onSuccess: (items) => {
        try {
          setReview({ planned: planEntry(parsed.rows, items, planContext), skippedBeyondLimit: parsed.skipped });
        } catch {
          setInputError("Não foi possível conferir os produtos. Tente novamente.");
        }
      },
    });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // The size is checked before the file is read into memory.
    if (file.size > MAX_ENTRY_BYTES) {
      setReview(null);
      setInputError(entryFailureMessages.too_large);
      return;
    }
    const content = await file.text();
    setText(content);
    check(content);
  };

  const toAdd = useMemo(() => review?.planned.filter((entry) => entry.skip === null && entry.product !== null) ?? [], [review]);
  const leftOut = review ? review.planned.length - toAdd.length : 0;
  const overLimit = existingCount + toAdd.length > MAX_ORDER_ROWS;
  const failure = resolve.isError ? describeApiError(resolve.error, "Não foi possível conferir os produtos") : null;

  const confirm = () => {
    onAdd(toAdd.flatMap((entry) => (entry.product ? [{ product: entry.product, quantityText: entry.row.quantityText.trim() }] : [])));
    onClose();
  };

  return (
    <DialogContent
      title="Lançamento múltiplo"
      description="Cole uma linha por produto ou leia um arquivo CSV. Nada é adicionado antes de você conferir."
      className="max-w-3xl"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          {review ? (
            <Button variant="primary" disabled={toAdd.length === 0 || overLimit} onClick={confirm}>
              {toAdd.length === 1 ? "Adicionar 1 item" : `Adicionar ${toAdd.length} itens`}
            </Button>
          ) : (
            <Button variant="primary" loading={resolve.isPending} disabled={text.trim() === ""} onClick={() => check(text)}>
              Conferir
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-entry-text" className="text-xs font-medium">
            Linhas (código ou referência; quantidade)
          </label>
          <Textarea
            id="bulk-entry-text"
            value={text}
            rows={6}
            // Editing while the lookup runs would leave a review for text that is no longer in the box.
            disabled={resolve.isPending}
            placeholder={EXAMPLE}
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setReview(null);
            }}
          />
          <FieldHint>
            Separe código e quantidade por ; ou tabulação (colar do Excel). Sem quantidade, vale 1. Até {MAX_ORDER_ROWS} linhas por vez.
          </FieldHint>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium" htmlFor="bulk-entry-file">
            Ou leia um arquivo CSV/TXT
          </label>
          <input
            id="bulk-entry-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="text-xs"
            disabled={resolve.isPending}
            onChange={(event) => void onFile(event)}
          />
        </div>
        {inputError ? <FieldError>{inputError}</FieldError> : null}
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
          </Alert>
        ) : null}

        {review ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="m-0 text-sm">
              <strong>{toAdd.length === 1 ? "1 item será adicionado" : `${toAdd.length} itens serão adicionados`}</strong>
              {leftOut > 0
                ? `; ${leftOut === 1 ? "1 linha fica de fora" : `${leftOut} linhas ficam de fora`} (motivo em cada linha).`
                : "."}
            </p>
            {review.skippedBeyondLimit > 0 ? (
              <Alert tone="warning" title="Linhas além do limite">
                Só as primeiras {MAX_ORDER_ROWS} linhas foram lidas; {review.skippedBeyondLimit} ficaram de fora. Importe o restante em
                outra vez.
              </Alert>
            ) : null}
            {overLimit ? (
              <Alert tone="warning" title="Itens demais para um pedido">
                Um pedido comporta até {MAX_ORDER_ROWS} itens e este já tem {existingCount}. Remova itens do pedido ou linhas da lista.
              </Alert>
            ) : null}
            <Table label="Conferência das linhas">
              <TableCaption>Conferência das linhas</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>Linha</TableHead>
                  <TableHead>Informado</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Qtd.</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.planned.map((entry) => (
                  <ReviewRow key={entry.row.line} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </DialogContent>
  );
}

function ReviewRow({ entry }: { entry: PlannedRow }) {
  const { row, product, candidates, skip } = entry;
  return (
    <TableRow>
      <TableCell numeric>{row.line}</TableCell>
      <TableCell wrap>{row.identifier}</TableCell>
      <TableCell wrap>
        {product ? (
          <>
            <span className="font-medium">{product.description}</span>
            <span className="block text-fg-muted">Código {product.code}</span>
          </>
        ) : candidates.length > 0 ? (
          <ul className="m-0 list-none p-0 text-fg-muted">
            {candidates.map((candidate) => (
              <li key={candidate.code}>
                {candidate.code} — {candidate.description}
              </li>
            ))}
          </ul>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>{row.quantityText}</TableCell>
      <TableCell wrap>
        {skip === null ? <Badge tone="success">Será adicionado</Badge> : <Badge tone="danger">{skipReasonMessages[skip]}</Badge>}
      </TableCell>
    </TableRow>
  );
}
