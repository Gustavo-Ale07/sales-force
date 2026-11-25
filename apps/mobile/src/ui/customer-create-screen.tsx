import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { customerStateLabel } from "@salesforce/domain";
import { buildCreateRequest, createProblems, emptyCreateForm, hasCreateProblems, ICMS_OPTIONS, type CreateForm, type CreateCustomerRequest } from "../data/customer-form";
import { Banner, CheckRow, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";

export interface CustomerCreateScreenProps {
  /** Saves the customer on the device (the sync engine delivers it, with its own idempotency key). Throws with a seller-facing message. */
  readonly onSave: (request: CreateCustomerRequest) => Promise<void>;
  readonly onClose: () => void;
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
export function CustomerCreateScreen({ onSave, onClose }: CustomerCreateScreenProps) {
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
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
  const problems = createProblems(form);
  const shown = (problem: string | null) => (showProblems ? problem : null);

  const submit = async () => {
    if (busy.current) return;
    setShowProblems(true);
    setFailure(null);
    if (hasCreateProblems(problems)) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSave(buildCreateRequest(form));
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
      <FormFrame title="Novo cliente" backLabel="Clientes" onCancel={onClose} footer={<FormButton label="Fechar" primary onPress={onClose} />}>
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
      title="Novo cliente"
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
        {failure !== null && <Banner text={failure} />}
        <FormField label="CPF/CNPJ" required value={form.document} onChangeText={(document) => change({ document })} error={shown(problems.document)} keyboardType="number-pad" />
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, color: "#4a5268" }}>Classificação ICMS *</Text>
          <View style={formStyles.chips}>
            {ICMS_OPTIONS.map((option) => {
              const on = form.icmsClassification === option;
              return (
                <Pressable key={option} style={[formStyles.chip, on && formStyles.chipOn]} onPress={() => change({ icmsClassification: option })} accessibilityRole="radio" accessibilityLabel={`ICMS ${option}`} accessibilityState={{ selected: on }}>
                  <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <FormField label="Razão social ou nome" required value={form.name} onChangeText={(name) => change({ name })} error={shown(problems.name)} />
        <FormField label="Nome fantasia" value={form.tradeName} onChangeText={(tradeName) => change({ tradeName })} error={shown(problems.tradeName)} />
        <FormField label="Inscrição estadual" value={form.exempt ? "" : form.stateRegistration} onChangeText={(stateRegistration) => change({ stateRegistration })} error={shown(problems.stateRegistration)} editable={!form.exempt} />
        <CheckRow label="Isento" checked={form.exempt} onChange={(exempt) => change({ exempt, ...(exempt ? { stateRegistration: "" } : {}) })} />
        <FormField label="Telefone" value={form.phone} onChangeText={(phone) => change({ phone })} error={shown(problems.phone)} keyboardType="phone-pad" />
        <FormField label="E-mail" value={form.email} onChangeText={(email) => change({ email })} error={shown(problems.email)} keyboardType="email-address" autoCapitalize="none" />
        <FormField label="Observações" value={form.notes} onChangeText={(notes) => change({ notes })} error={shown(problems.notes)} multiline />
      </ScrollView>
    </FormFrame>
  );
}
