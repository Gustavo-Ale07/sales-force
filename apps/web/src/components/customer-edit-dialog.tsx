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
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import {
  editProblems,
  emptyEditForm,
  hasEditProblems,
  describeCustomerWriteError,
  LIMITS,
  type ContactForm,
  type EditForm,
} from "../lib/customer-form";
import { CUSTOMER_STATE_LABELS, useUpdateCustomer } from "../lib/use-customer-write";

const FORM_ID = "customer-edit-form";

export interface CustomerEditDialogProps {
  customerCode: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Edit of the allow-listed fields (phone, e-mail, notes, contacts). Empty fields are left as they are. Shown only when the installation released it. */
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
  const counter = useRef(0);
  const problems = editProblems(form);
  const failure = save.isError ? describeCustomerWriteError(save.error, "Não foi possível salvar o cliente") : null;
  const refused = save.data?.state === "needs_correction" ? save.data : null;

  const set = (patch: Partial<EditForm>) => setForm((current) => ({ ...current, ...patch }));
  const setContact = (key: string, patch: Partial<ContactForm>) =>
    setForm((current) => ({ ...current, contacts: current.contacts.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)) }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (hasEditProblems(problems) || save.isPending) return;
    save.mutate(form, {
      onSuccess: (saved) => {
        if (saved.state === "needs_correction") return;
        toast({ title: CUSTOMER_STATE_LABELS[saved.state], description: `Cliente ${saved.customerCode}`, tone: "success" });
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
            Salvar
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
        {refused ? (
          <Alert tone="danger" title={CUSTOMER_STATE_LABELS.needs_correction}>
            {refused.reasonMessage ?? "O Sankhya recusou a alteração. Revise os dados e tente de novo."}
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

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-fg">Contatos</legend>
          {form.contacts.map((contact, index) => {
            const own = problems.contacts[index];
            const label = `contato ${index + 1}`;
            return (
              <div key={contact.key} role="group" aria-label={`Contato ${index + 1}`} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
                <FormField label="Nome do contato" required error={showProblems ? (own?.name ?? undefined) : undefined}>
                  <Input value={contact.name} autoComplete="off" onChange={(event) => setContact(contact.key, { name: event.target.value })} />
                </FormField>
                <FormField label="Cargo" error={showProblems ? (own?.role ?? undefined) : undefined}>
                  <Input value={contact.role} autoComplete="off" onChange={(event) => setContact(contact.key, { role: event.target.value })} />
                </FormField>
                <FormField label="Telefone do contato" error={showProblems ? (own?.phone ?? undefined) : undefined}>
                  <Input value={contact.phone} inputMode="tel" autoComplete="off" onChange={(event) => setContact(contact.key, { phone: event.target.value })} />
                </FormField>
                <FormField label="E-mail do contato" error={showProblems ? (own?.email ?? undefined) : undefined}>
                  <Input value={contact.email} type="email" autoComplete="off" onChange={(event) => setContact(contact.key, { email: event.target.value })} />
                </FormField>
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    leftIcon={<Trash2 size={13} aria-hidden="true" />}
                    onClick={() => setForm((current) => ({ ...current, contacts: current.contacts.filter((other) => other.key !== contact.key) }))}
                  >
                    Remover {label}
                  </Button>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={<Plus size={13} aria-hidden="true" />}
              disabled={form.contacts.length >= LIMITS.contacts}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  contacts: [...current.contacts, { key: `contact-${(counter.current += 1)}`, name: "", role: "", phone: "", email: "" }],
                }))
              }
            >
              Adicionar contato
            </Button>
          </div>
        </fieldset>
      </form>
    </DialogContent>
  );
}
