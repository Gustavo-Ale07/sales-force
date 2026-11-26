import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { CustomerListItem, CustomerRepository } from "../data/ports";
import {
  canConfirmImport,
  describeImportError,
  errorReportText,
  remap,
  resultSummary,
  type DatasetIdentity,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
  type ImportsPort,
  type ImportFile,
} from "../data/imports";
import { ApiRequestError } from "../data/api";
import { newClientRequestId } from "../lib/uuid";
import { ImportFileError, type ImportFilePort } from "../offline/import-file-expo";
import { colors, spacing } from "../theme";
import { Banner, FormButton, FormFrame, formStyles } from "./customer-form-parts";
import { CustomerPicker } from "./customer-picker";

export interface ImportScreenProps {
  readonly kind: ImportKind;
  readonly imports: ImportsPort;
  readonly files: ImportFilePort;
  readonly customers: CustomerRepository;
  readonly online: boolean;
  readonly onUnauthenticated: () => void;
  /** Opens the quotation just created (its customer and draft number are in the result). */
  readonly onClose: () => void;
  /** Id source, injectable for tests. */
  readonly newId?: () => string;
}

const TITLES: Record<ImportKind, string> = { order_items: "Importar itens do orçamento", customers: "Importar clientes" };

/** "Importar itens" / "Importar clientes": pick (customer and) file, check what the server recognised, confirm. Online only. */
export function ImportScreen({ kind, imports, files, customers, online, onUnauthenticated, onClose, newId = newClientRequestId }: ImportScreenProps) {
  const [customer, setCustomer] = useState<Pick<CustomerListItem, "code" | "name"> | null>(null);
  const [file, setFile] = useState<ImportFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const needsCustomer = kind === "order_items";
  const choosingCustomer = needsCustomer && customer === null;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const fail = (error: unknown, fallback: string) => {
    if (error instanceof ApiRequestError && error.status === 401) onUnauthenticated();
    setFailure(error instanceof ImportFileError ? error.message : describeImportError(error, fallback));
  };

  const runPreview = async (chosen: ImportFile, mapping?: Record<string, string | null>) => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await imports.preview({ type: kind, file: chosen, ...(customer === null ? {} : { customerCode: customer.code }), ...(mapping === undefined ? {} : { mapping }) });
      setPreview(next);
    } catch (error) {
      fail(error, "Não foi possível ler o arquivo.");
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async () => {
    setFailure(null);
    let chosen: ImportFile | null;
    try {
      chosen = await files.pick();
    } catch (error) {
      fail(error, "Não foi possível ler o arquivo.");
      return;
    }
    if (chosen === null) return;
    requestId.current = null;
    setPreview(null);
    setFile(chosen);
    await runPreview(chosen);
  };

  const confirm = async () => {
    if (file === null || preview === null) return;
    setBusy(true);
    setFailure(null);
    try {
      requestId.current ??= newId();
      let expectedDataset: DatasetIdentity | undefined;
      if (needsCustomer) {
        expectedDataset = (await imports.dataset()) ?? undefined;
        if (expectedDataset === undefined) throw new Error("no dataset");
      }
      const done = await imports.confirm({
        type: kind,
        file,
        mapping: preview.mapping,
        clientRequestId: requestId.current,
        ...(customer === null ? {} : { customerCode: customer.code }),
        ...(expectedDataset === undefined ? {} : { expectedDataset }),
      });
      requestId.current = null;
      setResult(done);
    } catch (error) {
      fail(error, "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  };

  if (choosingCustomer) {
    return (
      <FormFrame title={TITLES[kind]} backLabel="Clientes" onCancel={onClose} footer={<FormButton label="Cancelar" onPress={onClose} />}>
        <CustomerPicker customers={customers} onSelect={setCustomer} onUnauthenticated={onUnauthenticated} />
      </FormFrame>
    );
  }

  if (result !== null) {
    return (
      <FormFrame title={TITLES[kind]} backLabel="Clientes" onCancel={onClose} footer={<FormButton label="Fechar" primary onPress={onClose} />}>
        <ScrollView contentContainerStyle={formStyles.content}>
          <Text style={formStyles.resultTitle}>{resultSummary(result)}</Text>
          <ErrorList errors={result.errors} truncated={result.errorsTruncated} />
        </ScrollView>
      </FormFrame>
    );
  }

  const canConfirm = online && !busy && canConfirmImport(preview, kind, customer?.code ?? null);
  return (
    <FormFrame
      title={TITLES[kind]}
      backLabel="Clientes"
      onCancel={onClose}
      footer={
        <>
          <FormButton label="Cancelar" onPress={onClose} disabled={busy} />
          <FormButton label={busy ? "Aguarde" : kind === "customers" ? "Cadastrar clientes" : "Criar orçamento"} primary disabled={!canConfirm} onPress={() => void confirm()} />
        </>
      }
    >
      <ScrollView contentContainerStyle={formStyles.content}>
        {!online && <Banner text="Sem conexão com o servidor. A importação só funciona online." tone="warning" />}
        {failure !== null && <Banner text={failure} />}
        {customer !== null && <Text style={styles.customer}>{customer.name}</Text>}
        <FormButton label={file === null ? "Escolher arquivo" : `Arquivo: ${file.fileName}`} onPress={() => void chooseFile()} disabled={busy || !online} />
        {preview !== null && file !== null && <PreviewView preview={preview} busy={busy} onRemap={(field, header) => void runPreview(file, remap(preview.mapping, field, header))} />}
      </ScrollView>
    </FormFrame>
  );
}

function PreviewView({ preview, busy, onRemap }: { preview: ImportPreview; busy: boolean; onRemap: (field: string, header: string) => void }) {
  const [openField, setOpenField] = useState<string | null>(null);
  return (
    <View style={styles.block}>
      <View style={formStyles.group}>
        {preview.fields.map((field) => {
          const current = preview.mapping[field.id] ?? null;
          const open = openField === field.id;
          return (
            <View key={field.id}>
              <Pressable
                style={styles.mapRow}
                disabled={busy}
                onPress={() => setOpenField(open ? null : field.id)}
                accessibilityRole="button"
                accessibilityLabel={`Coluna de ${field.label}`}
              >
                <Text style={styles.mapLabel}>{field.required ? `${field.label} *` : field.label}</Text>
                <Text style={[styles.mapValue, current === null && field.required && styles.mapMissing]}>{current ?? "Não importar"}</Text>
              </Pressable>
              {open && (
                <View style={formStyles.chips}>
                  {["", ...preview.headers].map((header) => (
                    <Pressable
                      key={header === "" ? "none" : header}
                      style={[formStyles.chip, (current ?? "") === header && formStyles.chipOn]}
                      onPress={() => {
                        setOpenField(null);
                        onRemap(field.id, header);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={header === "" ? "Não importar" : `Usar coluna ${header}`}
                    >
                      <Text style={[formStyles.chipText, (current ?? "") === header && formStyles.chipTextOn]}>{header === "" ? "Não importar" : header}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
      {preview.missingRequired.length === 0 && (
        <>
          <Text style={styles.counts}>
            {`${preview.recognized} reconhecidas`}
            {preview.rejected > 0 ? ` · ${preview.rejected} com erro` : ""}
            {preview.skippedBlank > 0 ? ` · ${preview.skippedBlank} sem quantidade` : ""}
          </Text>
          <View style={formStyles.group}>
            {preview.sample.map((row) => (
              <View key={row.row} style={styles.sampleRow}>
                <Text style={styles.sampleLine}>{`Linha ${row.row}`}</Text>
                <Text style={styles.sampleText}>{row.ok ? `${row.label ?? ""}${row.quantity !== null ? ` · ${row.quantity}` : ""}` : (row.reason ?? "")}</Text>
              </View>
            ))}
          </View>
          <ErrorList errors={preview.errors} truncated={preview.errorsTruncated} />
        </>
      )}
    </View>
  );
}

function ErrorList({ errors, truncated }: { errors: readonly { row: number; reason: string }[]; truncated: boolean }) {
  if (errors.length === 0) return null;
  return (
    <View style={formStyles.group}>
      <Text style={formStyles.groupTitle}>Linhas não reconhecidas</Text>
      {errors.slice(0, 100).map((error) => (
        <Text key={error.row} style={styles.sampleText}>{`Linha ${error.row}: ${error.reason}`}</Text>
      ))}
      {(truncated || errors.length > 100) && <Text style={styles.sampleLine}>…</Text>}
      <FormButton label="Compartilhar relatório" onPress={() => void Share.share({ message: errorReportText(errors) })} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  customer: { fontSize: 16, fontWeight: "800", color: colors.navy },
  mapRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44, gap: spacing.sm },
  mapLabel: { fontSize: 14, color: colors.text, flexShrink: 1 },
  mapValue: { fontSize: 14, fontWeight: "700", color: colors.navy },
  mapMissing: { color: colors.red },
  counts: { fontSize: 14, fontWeight: "700", color: colors.text },
  sampleRow: { gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.xs },
  sampleLine: { fontSize: 12, color: colors.textMuted },
  sampleText: { fontSize: 14, color: colors.text },
});
