import { Alert, Button, Dialog, DialogClose, DialogContent, FormField, Input, toast } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { createOrderTemplate } from "../lib/api-mutations";
import { queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { requireDataset, useLoadedDataset } from "../lib/dataset";
import { MAX_TEMPLATE_NAME_LENGTH, describeTemplateError } from "../lib/order-templates";

export interface SaveTemplateItem {
  productCode: number;
  /** Decimal string ("2.5"), already validated. */
  quantity: string;
}

export interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: { code: number; name: string };
  /** Product and quantity of the current lines: nothing else is ever sent (no price, discount or note). */
  items: readonly SaveTemplateItem[];
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** "Salvar como recorrente": asks for a name and saves the current lines of the order as a template of the customer. */
export function SaveTemplateDialog({ open, onOpenChange, ...rest }: SaveTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open: every opening starts with an empty name and a fresh idempotency key. */}
      {open ? <SaveTemplateContent onClose={() => onOpenChange(false)} {...rest} /> : null}
    </Dialog>
  );
}

const FORM_ID = "save-template-form";

function SaveTemplateContent({
  onClose,
  customer,
  items,
}: Omit<SaveTemplateDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const loadedDataset = useLoadedDataset();
  const [name, setName] = useState("");
  const [showProblem, setShowProblem] = useState(false);
  // One key per dialog opening: a retry after a lost response resends the same key and cannot create a second template.
  // If the payload changes (another name after a conflict), the key changes with it, so it is never reused with other data.
  const requestRef = useRef<{ payload: string; id: string } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const nameProblem = trimmed === "" ? "Informe o nome do modelo." : null;

  const save = useMutation({
    mutationFn: () => {
      const expectedDataset = requireDataset(loadedDataset);
      const requestItems = items.map((item) => ({ productCode: item.productCode, quantity: item.quantity }));
      const payload = JSON.stringify([trimmed, requestItems]);
      if (requestRef.current?.payload !== payload) requestRef.current = { payload, id: newUuid() };
      return createOrderTemplate(api, customer.code, { clientRequestId: requestRef.current.id, expectedDataset, name: trimmed, items: requestItems });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplates(customer.code) });
      toast({
        title: "Modelo recorrente salvo",
        description: `${saved.name} · ${saved.items.length === 1 ? "1 item" : `${saved.items.length} itens`}. Use-o na página do cliente.`,
        tone: "success",
      });
      onClose();
    },
  });

  const failure = save.isError ? describeTemplateError(save.error, "Não foi possível salvar o modelo") : null;
  const nameTaken = failure?.reason === "name_taken";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblem(true);
    if (nameProblem === null && !save.isPending) save.mutate();
  };

  return (
    <DialogContent
      title="Salvar como recorrente"
      // The name is the only thing to fill in: focus it instead of the close button.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameInput.current?.focus();
      }}
      description={`${items.length === 1 ? "1 item" : `${items.length} itens`} do pedido de ${customer.name} serão guardados como modelo. Só produto e quantidade: os preços são calculados quando o modelo for usado.`}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} variant="primary" loading={save.isPending}>
            Salvar modelo
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate aria-label="Salvar como recorrente" className="flex flex-col gap-3">
        {failure && !nameTaken ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            {failure.correlationId ? (
              <span className="mt-1 block text-xs">
                Código de correlação: <span className="font-mono">{failure.correlationId}</span>
              </span>
            ) : null}
          </Alert>
        ) : null}
        <FormField
          label="Nome do modelo"
          required
          hint={`Até ${MAX_TEMPLATE_NAME_LENGTH} caracteres. Ex.: Reposição mensal.`}
          error={
            nameTaken
              ? "Já existe um modelo com este nome para este cliente. Escolha outro nome."
              : showProblem
                ? (nameProblem ?? undefined)
                : undefined
          }
        >
          <Input
            size="md"
            ref={nameInput}
            autoComplete="off"
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameTaken) save.reset();
            }}
          />
        </FormField>
      </form>
    </DialogContent>
  );
}
