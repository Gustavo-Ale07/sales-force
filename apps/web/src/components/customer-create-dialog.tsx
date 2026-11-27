import { Alert, Button, Checkbox, Dialog, DialogClose, DialogContent, FormField, Input, Select, toast } from "@salesforce/ui";
import { customerStateLabel } from "@salesforce/domain";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { applyCnpjLookup } from "../lib/customer-cnpj";
import { citiesQueryOptions, cnpjQueryOptions, customerPriceTablesQueryOptions, neighborhoodsQueryOptions, postalCodeQueryOptions, sellersQueryOptions, streetsQueryOptions } from "../lib/api-queries";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import {
  createProblems,
  describeCustomerWriteError,
  digitsOf,
  emptyCreateForm,
  LIMITS,
  matchCode,
  normalizeName,
  stepHasProblems,
  stepOfField,
  type CreateForm,
  type PersonType,
} from "../lib/customer-form";
import { useCreateCustomer } from "../lib/use-customer-write";
import { useIcmsOptions } from "../lib/use-icms-options";
import { CityPicker } from "./city-picker";
import { SellerPicker } from "./seller-picker";
import { SuggestInput } from "./suggest-input";

/** Profiles that may choose the owner seller of a new customer; everyone else is linked by the server. */
const SELLER_PICKER_ROLES: readonly string[] = ["admin", "manager"];

const FORM_ID = "customer-create-form";
const STEP_TITLES = ["Identificação", "Endereço e contato", "Comercial"] as const;
const LAST_STEP = STEP_TITLES.length - 1;

const formatCep = (value: string) => {
  const digits = digitsOf(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
};

export interface CustomerCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** New customer written to the ERP by the worker (D-AR). Shown only when the installation released creation. Three screens, same as the app. */
export function CustomerCreateDialog({ open, onOpenChange }: CustomerCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CreateBody onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function StepProgress({ step }: { step: number }) {
  return (
    <nav aria-label="Progresso do cadastro" data-testid="create-progress">
      <ol className="m-0 flex list-none gap-2 p-0">
        {STEP_TITLES.map((title, index) => (
          <li key={title} className="min-w-0 flex-1" aria-current={index === step ? "step" : undefined}>
            <div className={`h-1 rounded-full ${index <= step ? "bg-accent" : "bg-line"}`} aria-hidden="true" />
            <span className={`mt-1 block truncate text-xs ${index === step ? "font-semibold text-fg" : "text-fg-muted"}`}>
              {index + 1}. {title}
            </span>
          </li>
        ))}
      </ol>
    </nav>
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
  const cities = useQuery(citiesQueryOptions(api));
  const neighborhoods = useQuery(neighborhoodsQueryOptions(api));
  const streets = useQuery(streetsQueryOptions(api));
  const priceTables = useQuery(customerPriceTablesQueryOptions(api));
  const priceTableList = useMemo(() => priceTables.data?.items ?? [], [priceTables.data]);
  const defaultPriceTable = priceTables.data?.defaultCode ?? null;
  const cityList = useMemo(() => cities.data?.items ?? [], [cities.data]);
  const neighborhoodList = useMemo(() => neighborhoods.data?.items ?? [], [neighborhoods.data]);
  const streetList = useMemo(() => streets.data?.items ?? [], [streets.data]);
  const icmsOptions = useIcmsOptions();
  const [typedForm, setForm] = useState<CreateForm>(emptyCreateForm);
  // Until the person chooses, the field shows the installation default.
  const form = useMemo<CreateForm>(
    () => (typedForm.priceTableCode === null && defaultPriceTable !== null ? { ...typedForm, priceTableCode: defaultPriceTable } : typedForm),
    [typedForm, defaultPriceTable],
  );
  const [step, setStep] = useState(0);
  const [showProblems, setShowProblems] = useState(false);
  const problems = createProblems(form, needsSeller);
  const natural = form.personType === "F";
  const failure = create.isError ? describeCustomerWriteError(create.error, "Não foi possível cadastrar o cliente") : null;
  const visibleFields = [
    "document",
    "name",
    "phone",
    "email",
    "cityCode",
    "neighborhood",
    "street",
    "number",
    "complement",
    "priceTableCode",
    ...(natural ? [] : ["tradeName", "stateRegistration"]),
    ...(needsSeller ? ["sellerCode"] : []),
  ];
  // A refusal that named a field shows on that field only; anything else (or a field this form does not show) stays in the alert.
  const showAlert = failure !== null && (Object.keys(failure.fieldProblems).length === 0 || Object.keys(failure.fieldProblems).some((field) => !visibleFields.includes(field)));
  const set = (patch: Partial<CreateForm>) => setForm((current) => ({ ...current, ...patch }));
  const fieldError = (own: string | null, serverField: string) => failure?.fieldProblems[serverField] ?? (showProblems ? (own ?? undefined) : undefined);

  // CNPJ (legal entity): a valid 14-digit document is looked up once by the server; the answer fills only the empty fields. A failed lookup leaves the form free.
  const cnpjDigits = digitsOf(form.document);
  const cnpj = useQuery({ ...cnpjQueryOptions(api, cnpjDigits), enabled: !natural && cnpjDigits.length === 14 });
  const [appliedCnpj, setAppliedCnpj] = useState<string | null>(null);
  if (cnpj.data && appliedCnpj !== cnpjDigits) {
    setAppliedCnpj(cnpjDigits);
    setForm((current) => applyCnpjLookup(current, cnpj.data));
  }

  // CEP: at 8 digits the server looks it up once (cached for the session) and fills the address; every filled field stays editable.
  const cepDigits = digitsOf(form.postalCode);
  const cep = useQuery({ ...postalCodeQueryOptions(api, cepDigits), enabled: cepDigits.length === 8 });
  const [appliedCep, setAppliedCep] = useState<string | null>(null);
  const found = cep.data;
  // Applied while rendering (once per CEP), not in an effect. Without a registry city code the city is matched by exact name and state
  // once the registry is loaded; never guessed.
  if (found && appliedCep !== cepDigits && (!found.found || found.cityCode !== null || !cities.isPending)) {
    setAppliedCep(cepDigits);
    if (found.found) {
      const cityCode =
        found.cityCode ?? cityList.find((city) => found.city !== null && found.uf !== null && normalizeName(city.name) === normalizeName(found.city) && city.uf === found.uf.toUpperCase())?.code ?? null;
      setForm((current) => ({
        ...current,
        cityCode,
        street: found.street ?? "",
        streetCode: found.streetCode ?? (found.street ? matchCode(found.street, streetList) : null),
        neighborhood: found.neighborhood ?? "",
        neighborhoodCode: found.neighborhoodCode ?? (found.neighborhood ? matchCode(found.neighborhood, neighborhoodList) : null),
      }));
    }
  }

  const goTo = (next: number) => {
    setShowProblems(false);
    setStep(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    if (step < LAST_STEP) {
      if (stepHasProblems(problems, step)) setShowProblems(true);
      else goTo(step + 1);
      return;
    }
    const firstInvalid = STEP_TITLES.findIndex((_, index) => stepHasProblems(problems, index));
    if (firstInvalid >= 0) {
      setShowProblems(true);
      if (firstInvalid !== step) goTo(firstInvalid);
      return;
    }
    create.mutate(form, {
      onSuccess: (saved) => {
        toast({ title: saved.customerCode === null ? customerStateLabel("awaiting_send") : "Cliente cadastrado", description: saved.customerCode === null ? undefined : `Cliente ${saved.customerCode}`, tone: "success" });
        onClose();
        if (saved.customerCode !== null) void navigate({ to: "/clientes/$code", params: { code: String(saved.customerCode) } });
      },
      onError: (error) => {
        // The refusal named fields: show the screen that holds the first of them.
        const named = Object.keys(describeCustomerWriteError(error, "").fieldProblems).filter((field) => visibleFields.includes(field));
        if (named.length > 0) goTo(Math.min(...named.map(stepOfField)));
      },
    });
  };

  const personField = (
    <FormField label="Tipo de pessoa" required>
      <Select
        value={form.personType}
        onChange={(event) => set({ personType: event.target.value as PersonType })}
      >
        <option value="J">Pessoa Jurídica</option>
        <option value="F">Pessoa Física</option>
      </Select>
    </FormField>
  );

  return (
    <DialogContent
      title="Novo cliente"
      className="max-w-2xl"
      footer={
        <>
          {step === 0 ? (
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
          ) : (
            <Button type="button" variant="secondary" disabled={create.isPending} onClick={() => goTo(step - 1)}>
              Voltar
            </Button>
          )}
          <Button type="submit" form={FORM_ID} variant="primary" loading={create.isPending} disabled={create.isPending}>
            {step < LAST_STEP ? "Continuar" : create.isPending ? "Cadastrando..." : "Cadastrar"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate aria-label="Novo cliente" className="flex flex-col gap-4">
        <StepProgress step={step} />
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
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="create-step-1">
            {personField}
            <FormField label={natural ? "CPF" : "CNPJ"} required error={fieldError(problems.document, "document")}>
              <Input value={form.document} inputMode="numeric" autoComplete="off" onChange={(event) => set({ document: event.target.value })} />
            </FormField>
            <FormField label={natural ? "Nome" : "Razão social"} required error={fieldError(problems.name, "name")} className="sm:col-span-2">
              <Input value={form.name} autoComplete="off" maxLength={LIMITS.name} onChange={(event) => set({ name: event.target.value })} />
            </FormField>
            {natural ? null : (
              <>
                <FormField label="Nome fantasia" error={fieldError(problems.tradeName, "tradeName")} className="sm:col-span-2">
                  <Input value={form.tradeName} autoComplete="off" maxLength={LIMITS.tradeName} onChange={(event) => set({ tradeName: event.target.value })} />
                </FormField>
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
            {icmsOptions.length > 0 ? (
              <FormField label="Classificação ICMS" required className="sm:col-span-2">
                <Select value={form.icmsClassification} onChange={(event) => set({ icmsClassification: event.target.value as CreateForm["icmsClassification"] })}>
                  {icmsOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
          </div>
        ) : null}
        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="create-step-2">
            <FormField label="CEP">
              <Input value={form.postalCode} inputMode="numeric" autoComplete="off" maxLength={9} onChange={(event) => set({ postalCode: formatCep(event.target.value) })} />
            </FormField>
            <FormField label="Cidade" required error={fieldError(problems.cityCode, "cityCode")}>
              <CityPicker cities={cityList} value={form.cityCode} loading={cities.isPending} onChange={(code) => set({ cityCode: code })} />
            </FormField>
            <FormField label="Bairro" error={fieldError(problems.neighborhood, "neighborhood")}>
              <SuggestInput
                value={form.neighborhood}
                options={neighborhoodList}
                maxLength={LIMITS.addressName}
                onValueChange={(text) => set({ neighborhood: text, neighborhoodCode: matchCode(text, neighborhoodList) })}
              />
            </FormField>
            <FormField label="Rua" error={fieldError(problems.street, "street")}>
              <SuggestInput value={form.street} options={streetList} maxLength={LIMITS.addressName} onValueChange={(text) => set({ street: text, streetCode: matchCode(text, streetList) })} />
            </FormField>
            <FormField label="Número" error={fieldError(problems.number, "number")}>
              <Input value={form.number} autoComplete="off" maxLength={LIMITS.addressNumber} onChange={(event) => set({ number: event.target.value })} />
            </FormField>
            <FormField label="Complemento" error={fieldError(problems.complement, "complement")}>
              <Input value={form.complement} autoComplete="off" maxLength={LIMITS.addressComplement} onChange={(event) => set({ complement: event.target.value })} />
            </FormField>
            <FormField label="Telefone" error={fieldError(problems.phone, "phone")}>
              <Input value={form.phone} inputMode="tel" autoComplete="off" onChange={(event) => set({ phone: event.target.value })} />
            </FormField>
            <FormField label="E-mail" error={fieldError(problems.email, "email")}>
              <Input value={form.email} type="email" autoComplete="off" maxLength={LIMITS.email} onChange={(event) => set({ email: event.target.value })} />
            </FormField>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3" data-testid="create-step-3">
            <FormField label="Tabela de preço" required error={fieldError(problems.priceTableCode, "priceTableCode")}>
              <Select
                value={form.priceTableCode === null ? "" : String(form.priceTableCode)}
                disabled={priceTables.isPending}
                onChange={(event) => set({ priceTableCode: event.target.value === "" ? null : Number(event.target.value) })}
              >
                <option value="">Selecione</option>
                {priceTableList.map((table) => (
                  <option key={table.code} value={table.code}>
                    {table.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {needsSeller ? (
              <FormField label="Vendedor" required error={fieldError(problems.sellerCode, "sellerCode")}>
                <SellerPicker
                  sellers={activeSellers}
                  value={form.sellerCode === "" ? null : Number(form.sellerCode)}
                  loading={sellers.isPending}
                  disabled={sellers.isPending}
                  onChange={(code) => set({ sellerCode: code === null ? "" : String(code) })}
                />
              </FormField>
            ) : (
              <FormField label="Vendedor">
                <Input value={account?.name ?? ""} readOnly disabled />
              </FormField>
            )}
          </div>
        ) : null}
      </form>
    </DialogContent>
  );
}
