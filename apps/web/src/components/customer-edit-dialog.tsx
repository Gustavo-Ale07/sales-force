import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  FormField,
  Input,
  Textarea,
  toast,
} from "@salesforce/ui";
import { useState, type FormEvent } from "react";
import {
  editProblems,
  emptyEditForm,
  hasEditProblems,
  describeCustomerWriteError,
  LIMITS,
  type EditForm,
} from "../lib/customer-form";
import { useUpdateCustomer } from "../lib/use-customer-write";

const FORM_ID = "customer-edit-form";

export interface CustomerEditDialogProps {
  customerCode: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Edit of the allow-listed fields (phone, e-mail, notes). Empty fields are left as they are. Shown only when the installation released it. */
export function CustomerEditDialog({ customerCode, open, onOpenChange }: CustomerEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <EditBody customerCode={customerCode} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function EditBody({ customerCode, onClose }: { customerCode: number; onClose: () => void }) {
  const save = useUpdateCustomer(customerCode);
  const [form, setForm] = useState<EditForm>(emptyEditForm);
  const [showProblems, setShowProblems] = useState(false);
  const problems = editProblems(form);
  const failure = save.isError ? describeCustomerWriteError(save.error, "Não foi possível salvar o cliente") : null;

  const set = (patch: Partial<EditForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (hasEditProblems(problems) || save.isPending) return;
    save.mutate(form, {
      onSuccess: (saved) => {
        toast({ title: "Cliente alterado", description: `Cliente ${saved.customerCode}`, tone: "success" });
        onClose();
      },
    });
  };

  const fieldError = (own: string | null, serverField: string) => failure?.fieldProblems[serverField] ?? (showProblems ? (own ?? undefined) : undefined);

  return (
    <DialogContent
      title="Editar cliente"
      description={`Cliente ${customerCode}`}
      className="max-w-2xl"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} variant="primary" loading={save.isPending} disabled={save.isPending}>
            {save.isPending ? "Enviando..." : "Salvar"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate aria-label="Editar cliente" className="flex flex-col gap-3">
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            {failure.correlationId ? (
              <span className="mt-1 block text-xs">
                Código de correlação: <span className="font-mono">{failure.correlationId}</span>
              </span>
            ) : null}
          </Alert>
        ) : null}
        {showProblems && problems.empty ? <Alert tone="warning" title={problems.empty} /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Telefone" error={fieldError(problems.phone, "phone")}>
            <Input value={form.phone} inputMode="tel" autoComplete="off" onChange={(event) => set({ phone: event.target.value })} />
          </FormField>
          <FormField label="E-mail" error={fieldError(problems.email, "email")}>
            <Input value={form.email} type="email" autoComplete="off" maxLength={LIMITS.email} onChange={(event) => set({ email: event.target.value })} />
          </FormField>
        </div>
        <FormField label="Observações" error={fieldError(problems.notes, "notes")}>
          {(controlProps) => <Textarea {...controlProps} rows={3} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />}
        </FormField>

      </form>
    </DialogContent>
  );
}
