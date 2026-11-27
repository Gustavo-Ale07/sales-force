import { useEffect, useRef, useState } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import type { ConnectivityState } from "../connectivity/connectivity";
import {
  buildUpdateBody,
  describeCustomerWriteError,
  editProblems,
  emptyEditForm,
  hasEditProblems,
  isUnknownOutcome,
  LIMITS,
  type EditForm,
  type UpdateCustomerBody,
} from "../data/customer-form";
import type { CustomerWritePort, UpdateCustomerResult } from "../data/customer-write";
import { newClientRequestId } from "../lib/uuid";
import type { AddressPort } from "../offline/address-port";
import { PriceTablePicker, type PriceTableChoice } from "./price-table-picker";
import { Banner, FormButton, FormField, FormFrame, formStyles } from "./customer-form-parts";

export interface CustomerEditScreenProps {
  readonly customerName: string;
  readonly code: number;
  readonly writer: CustomerWritePort;
  /** The table the customer has now (`null` = none); the picker starts on it and the table is sent only when changed. */
  readonly currentPriceTableCode?: number | null;
  /** Source of the price tables (local copy of the last sync). Absent = the field is not shown. */
  readonly addresses?: Pick<AddressPort, "customerPriceTables">;
  /** Stores the edit in the local queue (sent by the next sync); used while offline. */
  readonly queueOffline?: (body: UpdateCustomerBody) => Promise<void>;
  readonly connectivity?: ConnectivityState;
  readonly onClose: () => void;
  /** Id source, injectable for tests. */
  readonly newId?: () => string;
}

/**
 * Edit of phone, e-mail and notes (D-AP). Online only: the app has no local edit queue yet, so offline says so and sends nothing.
 * Only the filled fields are sent. The request id is kept after a lost answer and replaced once the answer is final or the form changes.
 */
export function CustomerEditScreen({ customerName, code, writer, currentPriceTableCode = null, addresses, queueOffline, connectivity, onClose, newId = newClientRequestId }: CustomerEditScreenProps) {
  const [form, setForm] = useState<EditForm>(() => emptyEditForm(currentPriceTableCode));
  const [priceTables, setPriceTables] = useState<readonly PriceTableChoice[]>([]);
  const [showProblems, setShowProblems] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [result, setResult] = useState<UpdateCustomerResult | null>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  useEffect(() => {
    let current = true;
    void addresses?.customerPriceTables().then((answer) => {
      if (current) setPriceTables(answer.items);
    });
    return () => {
      current = false;
    };
  }, [addresses]);

  const change = (next: Partial<EditForm>) => {
    requestId.current = null; // The form changed: a new request.
    setForm((current) => ({ ...current, ...next }));
  };

  const problems = editProblems(form);
  const fieldError = (own: string | null, name: string) => (showProblems ? (own ?? failure?.fields[name] ?? null) : (failure?.fields[name] ?? null));

  const submit = async () => {
    if (sending) return;
    setShowProblems(true);
    setFailure(null);
    if (hasEditProblems(problems)) return;
    if (connectivity === "offline") {
      if (queueOffline === undefined) {
        setFailure({ message: "Sem conexão com o servidor. Nada foi alterado.", fields: {} });
        return;
      }
      setSending(true);
      try {
        await queueOffline(buildUpdateBody(newId(), form));
        onClose();
      } catch (error) {
        setFailure({ message: error instanceof Error ? error.message : "Não foi possível guardar a alteração.", fields: {} });
      } finally {
        setSending(false);
      }
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
            <Text style={formStyles.resultTitle}>{result.stateLabel}</Text>
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
        {priceTables.length > 0 && (
          <PriceTablePicker tables={priceTables} selectedCode={form.priceTableCode} onSelect={(priceTableCode) => change({ priceTableCode })} error={failure?.fields.priceTableCode ?? null} />
        )}
        <FormField label="Observações" value={form.notes} onChangeText={(notes) => change({ notes })} error={fieldError(problems.notes, "notes")} multiline />
      </ScrollView>
    </FormFrame>
  );
}
