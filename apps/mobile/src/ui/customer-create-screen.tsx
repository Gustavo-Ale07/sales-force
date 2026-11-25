import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { customerStateLabel, normalizeTaxDocument, taxDocumentKind } from "@salesforce/domain";
import type { CustomerRegistration } from "../data/customer-write";
import { buildCreateRequest, createProblems, emptyCreateForm, hasCreateProblems, type CreateForm, type CreateCustomerRequest, type IcmsClassificationOption, type SellerChoice } from "../data/customer-form";
import { colors } from "../theme";
import { Banner, CheckRow, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";

export interface CustomerCreateScreenProps {
  /** Saves the customer on the device (the sync engine delivers it, with its own idempotency key). Throws with a seller-facing message. */
  readonly onSave: (request: CreateCustomerRequest) => Promise<void>;
  readonly onClose: () => void;
  /** A refused registration being corrected: the form opens with its document and name and the request carries its id. */
  readonly correction?: CustomerRegistration;
  /**
   * The ICMS classifications with their names, as the server lists them (never invented here). Empty until the list is available:
   * the selector is then not shown and the request carries the default `R` (Revendedor), which the server also applies.
   */
  readonly icmsOptions?: readonly IcmsClassificationOption[];
  /** Active sellers to choose from; present ONLY when the signed-in user is not a seller. `null`/absent = a seller (no field). */
  readonly sellers?: readonly SellerChoice[] | null;
}

/** Local failures of the save, already in the seller's words (`PendingCustomerError`) or generic. */
function saveMessage(error: unknown): string {
  if (error instanceof Error && error.name === "PendingCustomerError") return error.message;
  return "Não foi possível salvar o cadastro neste aparelho. Tente de novo.";
}

/**
 * "Novo cliente". The customer is saved on the device first ("Salvo") and delivered by the sync engine; the list then shows its state
 * (Aguardando envio, Enviado ao Sankhya, Precisa de correção with the server's reason). Works offline.
 */
export function CustomerCreateScreen({ onSave, onClose, correction, icmsOptions = [], sellers = null }: CustomerCreateScreenProps) {
  // `sellers` is given only for a user who is not a seller (manager and equivalent): the field is then required. A seller's customer is linked automatically.
  const sellerRequired = sellers !== null;
  const [form, setForm] = useState<CreateForm>(() => (correction === undefined ? emptyCreateForm() : { ...emptyCreateForm(), document: correction.document, name: correction.name }));
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const change = (next: Partial<CreateForm>) => setForm((current) => ({ ...current, ...next }));
  const individual = taxDocumentKind(normalizeTaxDocument(form.document)) === "individual";
  const problems = createProblems(form, { sellerRequired });
  const shown = (problem: string | null) => (showProblems ? problem : null);

  const submit = async () => {
    if (busy.current) return;
    setShowProblems(true);
    setFailure(null);
    if (hasCreateProblems(problems)) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSave(buildCreateRequest(form, correction?.registrationId, { sellerRequired }));
      setSaved(true);
    } catch (error) {
      setFailure(saveMessage(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <FormFrame title={correction === undefined ? "Novo cliente" : "Corrigir cadastro"} backLabel="Clientes" onCancel={onClose} footer={<FormButton label="Fechar" primary onPress={onClose} />}>
        <View style={formStyles.content}>
          <View style={formStyles.group}>
            <Text style={formStyles.resultTitle}>{customerStateLabel("draft")}</Text>
          </View>
        </View>
      </FormFrame>
    );
  }

  return (
    <FormFrame
      title={correction === undefined ? "Novo cliente" : "Corrigir cadastro"}
      backLabel="Clientes"
      onCancel={onClose}
      footer={
        <>
          <FormButton label="Cancelar" onPress={onClose} />
          <FormButton label={saving ? "Salvando..." : "Cadastrar"} primary disabled={saving} onPress={() => void submit()} />
        </>
      }
    >
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {correction?.reasonMessage != null && <Banner tone="warning" text={correction.reasonMessage} />}
        {failure !== null && <Banner text={failure} />}
        <FormField label="CPF/CNPJ" required value={form.document} onChangeText={(document) => change({ document })} error={shown(problems.document)} keyboardType="number-pad" />
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
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 12, color: "#4a5268" }}>Vendedor *</Text>
            <View style={formStyles.chips}>
              {sellers.map((seller) => {
                const on = form.sellerCode === seller.code;
                return (
                  <Pressable key={seller.code} style={[formStyles.chip, on && formStyles.chipOn]} onPress={() => change({ sellerCode: seller.code })} accessibilityRole="radio" accessibilityLabel={`Vendedor ${seller.name}`} accessibilityState={{ selected: on }}>
                    <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{seller.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {shown(problems.sellerCode) !== null && <Text style={{ fontSize: 12, color: colors.red, fontWeight: "600" }}>{problems.sellerCode}</Text>}
          </View>
        )}
        <FormField label="Razão social ou nome" required value={form.name} onChangeText={(name) => change({ name })} error={shown(problems.name)} />
        <FormField label="Nome fantasia" value={form.tradeName} onChangeText={(tradeName) => change({ tradeName })} error={shown(problems.tradeName)} />
        {!individual && (
          <>
            <FormField label="Inscrição estadual" value={form.exempt ? "" : form.stateRegistration} onChangeText={(stateRegistration) => change({ stateRegistration })} error={shown(problems.stateRegistration)} editable={!form.exempt} />
            <CheckRow label="Isento" checked={form.exempt} onChange={(exempt) => change({ exempt, ...(exempt ? { stateRegistration: "" } : {}) })} />
          </>
        )}
        <FormField label="Telefone" value={form.phone} onChangeText={(phone) => change({ phone })} error={shown(problems.phone)} keyboardType="phone-pad" />
        <FormField label="E-mail" value={form.email} onChangeText={(email) => change({ email })} error={shown(problems.email)} keyboardType="email-address" autoCapitalize="none" />
        <FormField label="Observações" value={form.notes} onChangeText={(notes) => change({ notes })} error={shown(problems.notes)} multiline />
      </ScrollView>
    </FormFrame>
  );
}
