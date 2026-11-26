import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { normalizeTaxDocument, taxDocumentKind } from "@salesforce/domain";
import { buildCreateRequest, createProblems, emptyCreateForm, hasCreateProblems, type CreateForm, type CreateCustomerRequest, type IcmsClassificationOption, type SellerChoice } from "../data/customer-form";
import { CustomerRejectedError } from "../offline/pending-customers";
import { Banner, CheckRow, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";
import { SellerPicker } from "./seller-picker";

export interface CustomerCreateScreenProps {
  /**
   * "Cadastrar": online the server creates the customer in the ERP at once; offline (or a timeout) it is saved here and sent by itself.
   * A refusal throws `CustomerRejectedError` with the server's text per field; any other failure throws a seller-facing message.
   */
  readonly onSave: (request: CreateCustomerRequest) => Promise<void>;
  readonly onClose: () => void;
  /**
   * The ICMS classifications with their names, as the server lists them (never invented here). Empty until the list is available:
   * the selector is then not shown and the request carries the default `R` (Revendedor), which the server also applies.
   */
  readonly icmsOptions?: readonly IcmsClassificationOption[];
  /** Active sellers to choose from; present ONLY when the signed-in user is not a seller. `null`/absent = a seller (no field). */
  readonly sellers?: readonly SellerChoice[] | null;
}

/** Request fields that have an input on this form (a refusal text for any other key goes to the banner). */
const FORM_FIELDS = new Set(["document", "sellerCode", "name", "tradeName", "stateRegistration", "phone", "email", "notes", "icmsClassification"]);

/** Local failures of the save, already in the seller's words (`PendingCustomerError`) or generic. */
function saveMessage(error: unknown): string {
  if (error instanceof Error && error.name === "PendingCustomerError") return error.message;
  return "Não foi possível salvar o cadastro neste aparelho. Tente de novo.";
}

/** "Novo cliente". The button loads while the server creates the customer; a refusal shows the server's text on the field. */
export function CustomerCreateScreen({ onSave, onClose, icmsOptions = [], sellers = null }: CustomerCreateScreenProps) {
  // `sellers` is given only for a user who is not a seller (manager and equivalent): the field is then required. A seller's customer is linked automatically.
  const sellerRequired = sellers !== null;
  const [form, setForm] = useState<CreateForm>(() => emptyCreateForm());
  const [serverFields, setServerFields] = useState<Readonly<Record<string, string>>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const change = (next: Partial<CreateForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setServerFields((current) => (Object.keys(current).length === 0 ? current : Object.fromEntries(Object.entries(current).filter(([key]) => !(key in next)))));
  };
  const individual = taxDocumentKind(normalizeTaxDocument(form.document)) === "individual";
  const problems = createProblems(form, { sellerRequired });
  const shown = (problem: string | null) => (showProblems ? problem : null);
  // The server's text for a field wins over the local check (it is what actually refused the customer).
  const fieldError = (field: string, local: string | null) => serverFields[field] ?? shown(local);

  const submit = async () => {
    if (busy.current) return;
    setShowProblems(true);
    setFailure(null);
    setServerFields({});
    if (hasCreateProblems(problems)) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSave(buildCreateRequest(form, { sellerRequired }));
    } catch (error) {
      if (error instanceof CustomerRejectedError) {
        const { _: general, ...fields } = error.fields;
        setServerFields(fields);
        setFailure(general ?? (Object.keys(fields).some((key) => !FORM_FIELDS.has(key)) ? Object.values(fields).join(" ") : null));
      } else {
        setFailure(saveMessage(error));
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <FormFrame
      title="Novo cliente"
      backLabel="Clientes"
      onCancel={onClose}
      footer={
        <>
          <FormButton label="Cancelar" onPress={onClose} />
          <FormButton label={saving ? "Cadastrando..." : "Cadastrar"} primary disabled={saving} onPress={() => void submit()} />
        </>
      }
    >
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {failure !== null && <Banner text={failure} />}
        <FormField label="CPF/CNPJ" required value={form.document} onChangeText={(document) => change({ document })} error={fieldError("document", problems.document)} keyboardType="number-pad" />
        {icmsOptions.length > 0 && (
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 12, color: "#4a5268" }}>Classificação ICMS *</Text>
            <View style={formStyles.chips}>
              {icmsOptions.map((option) => {
                const on = form.icmsClassification === option.code;
                return (
                  <Pressable key={option.code} style={[formStyles.chip, on && formStyles.chipOn]} onPress={() => change({ icmsClassification: option.code })} accessibilityRole="radio" accessibilityLabel={`Classificação ${option.label}`} accessibilityState={{ selected: on }}>
                    <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {sellerRequired && (
          <SellerPicker sellers={sellers} selectedCode={form.sellerCode}onSelect={(sellerCode) => change({ sellerCode })} error={fieldError("sellerCode", problems.sellerCode)} />
        )}
        <FormField label="Razão social ou nome" required value={form.name} onChangeText={(name) => change({ name })} error={fieldError("name", problems.name)} />
        <FormField label="Nome fantasia" value={form.tradeName} onChangeText={(tradeName) => change({ tradeName })} error={fieldError("tradeName", problems.tradeName)} />
        {!individual && (
          <>
            <FormField label="Inscrição estadual" value={form.exempt ? "" : form.stateRegistration} onChangeText={(stateRegistration) => change({ stateRegistration })} error={fieldError("stateRegistration", problems.stateRegistration)} editable={!form.exempt} />
            <CheckRow label="Isento" checked={form.exempt} onChange={(exempt) => change({ exempt, ...(exempt ? { stateRegistration: "" } : {}) })} />
          </>
        )}
        <FormField label="Telefone" value={form.phone} onChangeText={(phone) => change({ phone })} error={fieldError("phone", problems.phone)} keyboardType="phone-pad" />
        <FormField label="E-mail" value={form.email} onChangeText={(email) => change({ email })} error={fieldError("email", problems.email)} keyboardType="email-address" autoCapitalize="none" />
        <FormField label="Observações" value={form.notes} onChangeText={(notes) => change({ notes })} error={fieldError("notes", problems.notes)} multiline />
      </ScrollView>
    </FormFrame>
  );
}
