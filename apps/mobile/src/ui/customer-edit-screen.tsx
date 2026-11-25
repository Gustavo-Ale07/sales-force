import { useEffect, useRef, useState } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { customerStateLabel } from "@salesforce/domain";
import type { ConnectivityState } from "../connectivity/connectivity";
import {
  buildUpdateBody,
  describeCustomerWriteError,
  editProblems,
  emptyEditForm,
  hasEditProblems,
  isUnknownOutcome,
  LIMITS,
  type ContactForm,
  type EditForm,
} from "../data/customer-form";
import type { CustomerWritePort, UpdateCustomerResult } from "../data/customer-write";
import { newClientRequestId } from "../lib/uuid";
import { Banner, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";

export interface CustomerEditScreenProps {
  readonly customerName: string;
  readonly code: number;
  readonly writer: CustomerWritePort;
  readonly connectivity?: ConnectivityState;
  readonly onClose: () => void;
  /** Id source, injectable for tests. */
  readonly newId?: () => string;
}

/**
 * Edit of phone, e-mail, notes and contacts (D-AP). Online only: the app has no local edit queue yet, so offline says so and sends nothing.
 * Only the filled fields are sent. The request id is kept after a lost answer and replaced once the answer is final or the form changes.
 */
export function CustomerEditScreen({ customerName, code, writer, connectivity, onClose, newId = newClientRequestId }: CustomerEditScreenProps) {
  const [form, setForm] = useState<EditForm>(emptyEditForm);
  const [showProblems, setShowProblems] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [result, setResult] = useState<UpdateCustomerResult | null>(null);
  const requestId = useRef<string | null>(null);
  const contactCounter = useRef(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const change = (next: Partial<EditForm>) => {
    requestId.current = null; // The form changed: a new request.
    setForm((current) => ({ ...current, ...next }));
  };
  const changeContact = (key: string, next: Partial<ContactForm>) => change({ contacts: form.contacts.map((contact) => (contact.key === key ? { ...contact, ...next } : contact)) });

  const problems = editProblems(form);
  const fieldError = (own: string | null, name: string) => (showProblems ? (own ?? failure?.fields[name] ?? null) : (failure?.fields[name] ?? null));

  const submit = async () => {
    if (sending) return;
    setShowProblems(true);
    setFailure(null);
    if (hasEditProblems(problems)) return;
    if (connectivity === "offline") {
      setFailure({ message: "Sem conexão com o servidor. Nada foi alterado.", fields: {} });
      return;
    }
    requestId.current ??= newId();
    setSending(true);
    try {
      setResult(await writer.update(code, buildUpdateBody(requestId.current, form)));
      requestId.current = null;
    } catch (error) {
      const described = describeCustomerWriteError(error);
      setFailure({ message: described.message, fields: described.fieldProblems });
      if (!isUnknownOutcome(error)) requestId.current = null; // Definitive answer: the next try is a new request.
    } finally {
      setSending(false);
    }
  };

  if (result !== null) {
    return (
      <FormFrame title="Editar cliente" backLabel="Ficha" onCancel={onClose} footer={<FormButton label="Fechar" primary onPress={onClose} />}>
        <View style={formStyles.content}>
          <View style={formStyles.group}>
            <Text style={formStyles.resultTitle}>{customerStateLabel(result.state)}</Text>
            {result.state === "needs_correction" && result.reasonMessage !== null && <Text style={formStyles.resultText}>{result.reasonMessage}</Text>}
          </View>
        </View>
      </FormFrame>
    );
  }

  return (
    <FormFrame
      title="Editar cliente"
      backLabel="Ficha"
      onCancel={onClose}
      footer={
        <>
          <FormButton label="Cancelar" onPress={onClose} />
          <FormButton label={sending ? "Enviando..." : "Salvar"} primary disabled={sending} onPress={() => void submit()} />
        </>
      }
    >
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={formStyles.groupTitle}>{customerName}</Text>
        {failure !== null && <Banner text={failure.message} />}
        {showProblems && problems.empty !== null && <Banner tone="warning" text={problems.empty} />}
        <FormField label="Telefone" value={form.phone} onChangeText={(phone) => change({ phone })} error={fieldError(problems.phone, "phone")} keyboardType="phone-pad" />
        <FormField label="E-mail" value={form.email} onChangeText={(email) => change({ email })} error={fieldError(problems.email, "email")} keyboardType="email-address" autoCapitalize="none" maxLength={LIMITS.email + 20} />
        <FormField label="Observações" value={form.notes} onChangeText={(notes) => change({ notes })} error={fieldError(problems.notes, "notes")} multiline />
        {form.contacts.map((contact, index) => {
          const own = problems.contacts[index];
          const shown = (problem: string | null | undefined) => (showProblems ? (problem ?? null) : null);
          return (
            <View key={contact.key} style={formStyles.group} accessibilityLabel={`Contato ${index + 1}`}>
              <FormField label="Nome do contato" required value={contact.name} onChangeText={(name) => changeContact(contact.key, { name })} error={shown(own?.name)} />
              <FormField label="Cargo" value={contact.role} onChangeText={(role) => changeContact(contact.key, { role })} error={shown(own?.role)} />
              <FormField label="Telefone do contato" value={contact.phone} onChangeText={(phone) => changeContact(contact.key, { phone })} error={shown(own?.phone)} keyboardType="phone-pad" />
              <FormField label="E-mail do contato" value={contact.email} onChangeText={(email) => changeContact(contact.key, { email })} error={shown(own?.email)} keyboardType="email-address" autoCapitalize="none" />
              <FormButton label={`Remover contato ${index + 1}`} onPress={() => change({ contacts: form.contacts.filter((other) => other.key !== contact.key) })} />
            </View>
          );
        })}
        {form.contacts.length < LIMITS.contacts && (
          <FormButton
            label="Adicionar contato"
            onPress={() => {
              contactCounter.current += 1;
              change({ contacts: [...form.contacts, { key: `contact-${contactCounter.current}`, name: "", role: "", phone: "", email: "" }] });
            }}
          />
        )}
      </ScrollView>
    </FormFrame>
  );
}
