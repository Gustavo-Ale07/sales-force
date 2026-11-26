import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  FieldError,
  Select,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent } from "react";
import {
  IMPORT_MAX_FILE_BYTES,
  confirmImport,
  downloadFile,
  errorReportCsv,
  previewImport,
  readFileAsBase64,
  saveBlob,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
} from "../lib/api-imports";
import { useApi } from "../lib/app-context";
import { useLoadedDataset, requireDataset } from "../lib/dataset";
import { describeApiError } from "../lib/error-message";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ImportKind;
}

const TITLES: Record<ImportKind, string> = { order_items: "Importar itens do orçamento", customers: "Importar clientes" };

export function ImportDialog({ open, onOpenChange, type }: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ImportBody type={type} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

interface Chosen {
  fileName: string;
  contentBase64: string;
}

function ImportBody({ type, onClose }: { type: ImportKind; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const loadedDataset = useLoadedDataset();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [file, setFile] = useState<Chosen | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const needsCustomer = type === "order_items";

  const run = useMutation({
    mutationFn: (input: { file: Chosen; mapping?: Record<string, string | null> }) =>
      previewImport(api, {
        type,
        fileName: input.file.fileName,
        contentBase64: input.file.contentBase64,
        ...(needsCustomer && customer ? { customerCode: customer.code } : {}),
        ...(input.mapping ? { mapping: input.mapping } : {}),
      }),
    onSuccess: (data) => setPreview(data),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!file || !preview) throw new Error("no file");
      requestId.current ??= globalThis.crypto.randomUUID();
      return confirmImport(api, {
        type,
        fileName: file.fileName,
        contentBase64: file.contentBase64,
        mapping: preview.mapping,
        clientRequestId: requestId.current,
        ...(needsCustomer && customer ? { customerCode: customer.code } : {}),
        ...(needsCustomer ? { expectedDataset: requireDataset(loadedDataset) } : {}),
      });
    },
    onSuccess: (data) => {
      requestId.current = null;
      setResult(data);
      void queryClient.invalidateQueries();
    },
  });

  const template = useMutation({ mutationFn: () => downloadFile("/imports/templates/order-items", {}, "modelo-importacao-itens.xlsx") });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setFileError(null);
    setPreview(null);
    requestId.current = null;
    if (chosen.size > IMPORT_MAX_FILE_BYTES) {
      setFile(null);
      setFileError("O arquivo é grande demais (limite de 20 MB).");
      return;
    }
    try {
      const next = { fileName: chosen.name, contentBase64: await readFileAsBase64(chosen) };
      setFile(next);
      run.mutate({ file: next });
    } catch {
      setFile(null);
      setFileError("Não foi possível ler o arquivo.");
    }
  };

  const remap = (field: string, header: string) => {
    if (!file || !preview) return;
    run.mutate({ file, mapping: { ...preview.mapping, [field]: header === "" ? null : header } });
  };

  const failure = run.isError ? describeApiError(run.error, "Não foi possível ler o arquivo") : confirm.isError ? describeApiError(confirm.error, "Não foi possível importar") : null;
  const canConfirm = preview !== null && preview.missingRequired.length === 0 && preview.recognized > 0 && (!needsCustomer || customer !== null);

  return (
    <DialogContent
      title={TITLES[type]}
      className="max-w-3xl"
      footer={
        result ? (
          <DialogClose asChild>
            <Button variant="primary">Fechar</Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
            </DialogClose>
            <Button variant="primary" loading={confirm.isPending} disabled={!canConfirm || run.isPending} onClick={() => confirm.mutate()}>
              {type === "customers" ? "Cadastrar clientes" : "Criar orçamento"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ResultView result={result} />
      ) : (
        <div className="flex flex-col gap-3">
          {needsCustomer ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Cliente</span>
              <CustomerPicker selected={customer} onSelect={(picked) => setCustomer(picked ? { code: picked.code, name: picked.name } : null)} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium" htmlFor="import-file">
              Arquivo (.xlsx ou .csv)
            </label>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-xs"
              disabled={run.isPending || confirm.isPending}
              onChange={(event) => void onFile(event)}
            />
            {needsCustomer ? (
              <Button size="sm" variant="secondary" loading={template.isPending} onClick={() => template.mutate()}>
                Baixar modelo
              </Button>
            ) : null}
          </div>
          {fileError ? <FieldError>{fileError}</FieldError> : null}
          {failure ? (
            <Alert tone="danger" title={failure.title}>
              {failure.description}
            </Alert>
          ) : null}
          {preview ? <PreviewView preview={preview} onRemap={remap} busy={run.isPending} /> : null}
        </div>
      )}
    </DialogContent>
  );
}

function PreviewView({ preview, onRemap, busy }: { preview: ImportPreview; onRemap: (field: string, header: string) => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="grid gap-2 sm:grid-cols-2">
        {preview.fields.map((field) => (
          <label key={field.id} className="flex flex-col gap-1 text-xs font-medium">
            {field.label}
            {field.required ? " *" : ""}
            <Select size="md" value={preview.mapping[field.id] ?? ""} disabled={busy} onChange={(event) => onRemap(field.id, event.target.value)}>
              <option value="">Não importar</option>
              {preview.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {preview.missingRequired.length === 0 ? (
        <>
          <p className="m-0 flex flex-wrap gap-2 text-sm">
            <Badge tone="success">{preview.recognized} reconhecidas</Badge>
            {preview.rejected > 0 ? <Badge tone="danger">{preview.rejected} com erro</Badge> : null}
            {preview.skippedBlank > 0 ? <Badge tone="neutral">{preview.skippedBlank} sem quantidade</Badge> : null}
          </p>
          <Table label="Conferência das linhas">
            <TableCaption>Conferência das linhas</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Linha</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Qtd.</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.map((row) => (
                <TableRow key={row.row}>
                  <TableCell numeric>{row.row}</TableCell>
                  <TableCell wrap>{row.label ?? "—"}</TableCell>
                  <TableCell>{row.quantity ?? ""}</TableCell>
                  <TableCell wrap>{row.ok ? <Badge tone="success">Reconhecida</Badge> : <Badge tone="danger">{row.reason}</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ErrorReport errors={preview.errors} />
        </>
      ) : null}
    </div>
  );
}

function ErrorReport({ errors }: { errors: readonly { row: number; reason: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => saveBlob(errorReportCsv(errors), "erros-importacao.csv")}>
        Baixar relatório de erros
      </Button>
    </div>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="m-0 flex flex-wrap gap-2 text-sm">
        <Badge tone="success">{result.created} {result.type === "customers" ? "clientes cadastrados" : "itens no orçamento"}</Badge>
        {result.pending > 0 ? <Badge tone="warning">{result.pending} aguardando o ERP</Badge> : null}
        {result.rejected > 0 ? <Badge tone="danger">{result.rejected} com erro</Badge> : null}
      </p>
      {result.orderId ? (
        <Button asChild variant="secondary" size="sm">
          <Link to="/pedidos/$id" params={{ id: result.orderId }}>
            Abrir orçamento
          </Link>
        </Button>
      ) : null}
      {result.errors.length > 0 ? (
        <Table label="Linhas com erro">
          <TableCaption>Linhas com erro</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead numeric>Linha</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.errors.slice(0, 100).map((error) => (
              <TableRow key={error.row}>
                <TableCell numeric>{error.row}</TableCell>
                <TableCell wrap>{error.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <ErrorReport errors={result.errors} />
    </div>
  );
}
