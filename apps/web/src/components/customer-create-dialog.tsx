import { Alert, Button, Checkbox, Dialog, DialogClose, DialogContent, FormField, Input, Select, Textarea, toast } from "@salesforce/ui";
import { customerStateLabel } from "@salesforce/domain";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { sellersQueryOptions } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import {
  createProblems,
  describeCustomerWriteError,
  emptyCreateForm,
  hasCreateProblems,
  isNaturalPerson,
  LIMITS,
  type CreateForm,
} from "../lib/customer-form";
import { useCreateCustomer } from "../lib/use-customer-write";
import { useIcmsOptions } from "../lib/use-icms-options";

/** Profiles that may choose the owner seller of a new customer; everyone else is linked by the server. */
const SELLER_PICKER_ROLES: readonly string[] = ["admin", "manager"];

const FORM_ID = "customer-create-form";

export interface CustomerCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** New customer written to the ERP by the worker (D-AR). Shown only when the installation released creation. Same fields and order as the app. */
export function CustomerCreateDialog({ open, onOpenChange }: CustomerCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CreateBody onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function CreateBody({ onClose }: { onClose: () => void }) {
  const create = useCreateCustomer();
  const navigate = useNavigate();
  const { authClient } = useAppServices();
  const api = useApi();
  const session = useQuery(sessionQueryOptions(authClient));
  const account = session.data;
  // A seller (has an ERP seller code) owns what they create, no field; a management profile without one picks an active seller.
  const needsSeller = account !== null && account !== undefined && account.sellerCodes.length === 0 && SELLER_PICKER_ROLES.includes(account.role);
  const sellers = useQuery({ ...sellersQueryOptions(api), enabled: needsSeller });
  const activeSellers = (sellers.data?.items ?? []).filter((seller) => seller.active);
  const icmsOptions = useIcmsOptions();
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
  const [showProblems, setShowProblems] = useState(false);
  const problems = createProblems(form, needsSeller);
  const naturalPerson = isNaturalPerson(form.document);
  const failure = create.isError ? describeCustomerWriteError(create.error, "Não foi possível cadastrar o cliente") : null;
  const visibleFields = ["document", "name", "tradeName", "phone", "email", "notes", ...(naturalPerson ? [] : ["stateRegistration"]), ...(needsSeller ? ["sellerCode"] : [])];
  // A refusal that named a field shows on that field only; anything else (or a field this form does not show) stays in the alert.
  const showAlert = failure !== null && (Object.keys(failure.fieldProblems).length === 0 || Object.keys(failure.fieldProblems).some((field) => !visibleFields.includes(field)));
  const set = (patch: Partial<CreateForm>) => setForm((current) => ({ ...current, ...patch }));
  const fieldError = (own: string | null, serverField: string) => failure?.fieldProblems[serverField] ?? (showProblems ? (own ?? undefined) : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (hasCreateProblems(problems) || create.isPending) return;
    create.mutate(form, {
      onSuccess: (saved) => {
        toast({ title: saved.customerCode === null ? customerStateLabel("awaiting_send") : "Cliente cadastrado", description: saved.customerCode === null ? undefined : `Cliente ${saved.customerCode}`, tone: "success" });
        onClose();
        if (saved.customerCode !== null) void navigate({ to: "/clientes/$code", params: { code: String(saved.customerCode) } });
      },
    });
  };

  return (
    <DialogContent
      title="Novo cliente"
      className="max-w-2xl"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} variant="primary" loading={create.isPending} disabled={create.isPending}>
            {create.isPending ? "Cadastrando..." : "Cadastrar"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate aria-label="Novo cliente" className="flex flex-col gap-3">
        {failure && showAlert ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
            {failure.correlationId ? (
              <span className="mt-1 block text-xs">
                Código de correlação: <span className="font-mono">{failure.correlationId}</span>
              </span>
            ) : null}
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="CPF/CNPJ" required error={fieldError(problems.document, "document")}>
            <Input value={form.document} inputMode="numeric" autoComplete="off" onChange={(event) => set({ document: event.target.value })} />
          </FormField>
          {icmsOptions.length > 0 ? (
            <FormField label="Classificação ICMS" required>
              <Select value={form.icmsClassification} onChange={(event) => set({ icmsClassification: event.target.value as CreateForm["icmsClassification"] })}>
                {icmsOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {needsSeller ? (
            <FormField label="Vendedor" required error={fieldError(problems.sellerCode, "sellerCode")}>
              <Select value={form.sellerCode} disabled={sellers.isPending} onChange={(event) => set({ sellerCode: event.target.value })}>
                <option value="">{sellers.isPending ? "Carregando…" : "Selecione"}</option>
                {activeSellers.map((seller) => (
                  <option key={seller.code} value={String(seller.code)}>
                    {seller.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          <FormField label="Razão social ou nome" required error={fieldError(problems.name, "name")}>
            <Input value={form.name} autoComplete="off" maxLength={LIMITS.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Nome fantasia" error={fieldError(problems.tradeName, "tradeName")}>
            <Input value={form.tradeName} autoComplete="off" maxLength={LIMITS.tradeName} onChange={(event) => set({ tradeName: event.target.value })} />
          </FormField>
          {naturalPerson ? null : (
            <>
              <FormField label="Inscrição estadual" error={fieldError(problems.stateRegistration, "stateRegistration")}>
                <Input
                  value={form.exempt ? "" : form.stateRegistration}
                  disabled={form.exempt}
                  autoComplete="off"
                  maxLength={LIMITS.stateRegistration}
                  onChange={(event) => set({ stateRegistration: event.target.value })}
                />
              </FormField>
              <div className="flex items-end pb-2">
                <Checkbox label="Isento" checked={form.exempt} onCheckedChange={(checked) => set({ exempt: checked === true })} />
              </div>
            </>
          )}
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
