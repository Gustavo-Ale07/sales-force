import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  FieldError,
  FieldHint,
  FormField,
  Input,
  SkeletonLines,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { replaceOrderTemplate, resolveProducts } from "../lib/api-mutations";
import { orderTemplateQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { errorStatus } from "../lib/http-error";
import { parseQuantityInput, quantityProblemMessages } from "../lib/order-draft";
import { MAX_TEMPLATE_ITEMS, MAX_TEMPLATE_NAME_LENGTH, describeTemplateError } from "../lib/order-templates";
import { ProductPicker } from "./product-picker";
import { QueryError } from "./query-error";

type OrderTemplateDetail = ApiSchema<"OrderTemplateDetail">;

interface FormLine {
  key: string;
  productCode: number;
  /** Known only for products added in this dialog or resolved from the catalog; never invented. */
  description: string | null;
  /** As typed (pt-BR, decimal comma). */
  quantityText: string;
}

const FORM_ID = "order-template-edit-form";
const PRODUCT_SEARCH_ID = "template-product-search";

export interface OrderTemplateEditDialogProps {
  customerCode: number;
  /** Template to edit; the dialog is open while this is set. */
  template: { id: string; name: string } | null;
  onClose: () => void;
}

/** Edit a recurring template: name and product/quantity lines (full replace with the version read when the dialog opened). */
export function OrderTemplateEditDialog({ customerCode, template, onClose }: OrderTemplateEditDialogProps) {
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      {template ? <EditBody customerCode={customerCode} templateId={template.id} templateName={template.name} onClose={onClose} /> : null}
    </Dialog>
  );
}

function EditBody({
  customerCode,
  templateId,
  templateName,
  onClose,
}: {
  customerCode: number;
  templateId: string;
  templateName: string;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  // Always confirm with the server on open, and never refetch behind the form's back: a newer version landing while the
  // seller types would re-key the form and discard the input. Only the explicit "Recarregar" replaces the loaded version.
  const query = useQuery({
    ...orderTemplateQueryOptions(api, templateId),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // A cached copy (e.g. of an earlier edit) is not shown as the form: wait for the fetch made on open to settle.
  const [cachedAtOpen] = useState(() => query.dataUpdatedAt);
  const settled = query.dataUpdatedAt !== cachedAtOpen;

  // The template is gone (deleted elsewhere): the list on screen is stale too.
  const notFound = errorStatus(query.error) === 404;
  useEffect(() => {
    if (notFound) void queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplates(customerCode) });
  }, [notFound, queryClient, customerCode]);

  // Descriptions are a convenience for reading the list: the template itself stores codes only. Failures fall back to the code.
  const codes = useMemo(() => query.data?.items.map((item) => item.productCode) ?? [], [query.data]);
  const descriptions = useQuery({
    queryKey: ["order-templates", "descriptions", templateId, query.data?.version ?? 0],
    enabled: codes.length > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await resolveProducts(api, { customerCode, identifiers: codes.slice(0, 500).map(String) });
      const found = new Map<number, string>();
      for (const item of response.items) {
        for (const product of item.product ? [item.product] : (item.candidates ?? [])) {
          if (codes.includes(product.code)) found.set(product.code, product.description);
        }
      }
      return found;
    },
  });

  // The footer (Cancelar/Salvar) lives inside EditForm's mutation state; it reports it here so the dialog chrome
  // (title bar, footer bar) stays a single DialogContent instance across loading → loaded, instead of remounting.
  const [footer, setFooter] = useState<ReactNode>(null);

  if (query.isPending || (!query.isError && !settled)) {
    return (
      <DialogContent title="Editar modelo recorrente" description={`Modelo: ${templateName}`} className="max-w-2xl">
        <div aria-busy="true">
          <SkeletonLines lines={5} label="Carregando modelo…" />
        </div>
      </DialogContent>
    );
  }
  if (query.isError) {
    return (
      <DialogContent title="Editar modelo recorrente" description={`Modelo: ${templateName}`} className="max-w-2xl">
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
          title="Não foi possível carregar o modelo"
          compact
        />
      </DialogContent>
    );
  }
  return (
    <DialogContent
      title="Editar modelo recorrente"
      description="Só produto e quantidade são guardados. Os preços são calculados quando o modelo é usado."
      className="max-w-2xl"
      footer={footer}
    >
      <EditForm
        // Re-keyed on every server version: a reload after a conflict always starts from the authoritative data.
        key={`${query.data.id}:${query.data.version}`}
        detail={query.data}
        customerCode={customerCode}
        descriptions={descriptions.data ?? null}
        onReload={() => void query.refetch()}
        reloading={query.isRefetching}
        onClose={onClose}
        onFooterChange={setFooter}
      />
    </DialogContent>
  );
}

interface EditFormProps {
  detail: OrderTemplateDetail;
  customerCode: number;
  descriptions: ReadonlyMap<number, string> | null;
  onReload: () => void;
  reloading: boolean;
  onClose: () => void;
  /** Reports the footer buttons up to EditBody's single DialogContent (they depend on save's mutation state). */
  onFooterChange: (footer: ReactNode) => void;
}

function EditForm({ detail, customerCode, descriptions, onReload, reloading, onClose, onFooterChange }: EditFormProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const counter = useRef(0);
  const nextKey = () => `tline-${(counter.current += 1)}`;

  const [name, setName] = useState(detail.name);
  const [lines, setLines] = useState<FormLine[]>(() =>
    detail.items.map((item, index) => ({
      key: `tline-init-${index}`,
      productCode: item.productCode,
      description: null,
      quantityText: item.quantity.replace(".", ","),
    })),
  );
  const [showProblems, setShowProblems] = useState(false);

  const trimmedName = name.trim();
  const nameProblem = trimmedName === "" ? "Informe o nome do modelo." : null;
  const parsed = lines.map((line) => parseQuantityInput(line.quantityText));
  const itemsProblem = lines.length === 0 ? "Adicione ao menos um produto." : null;
  const valid = nameProblem === null && itemsProblem === null && parsed.every((entry) => entry.ok);

  const save = useMutation({
    mutationFn: () =>
      replaceOrderTemplate(api, detail.id, {
        expectedVersion: detail.version,
        name: trimmedName,
        // Product and quantity only: the server never accepts (and this UI never holds) a price.
        items: lines.flatMap((line, index) => {
          const quantity = parsed[index];
          return quantity?.ok ? [{ productCode: line.productCode, quantity: quantity.value }] : [];
        }),
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.orderTemplate(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplates(saved.customerCode) });
      toast({ title: "Modelo atualizado", description: saved.name, tone: "success" });
      onClose();
    },
    onError: (error) => {
      // A stale version or a template deleted elsewhere means the list on screen is stale too. Only the list is refreshed:
      // the loaded detail (and the seller's input) is replaced only by an explicit reload.
      if (errorStatus(error) === 404 || describeTemplateError(error, "").reason === "version_conflict")
        void queryClient.invalidateQueries({ queryKey: queryKeys.orderTemplates(customerCode) });
    },
  });

  const failure = save.isError ? describeTemplateError(save.error, "Não foi possível salvar o modelo") : null;
  const nameTaken = failure?.reason === "name_taken";

  const nameInput = useRef<HTMLInputElement>(null);
  /** Enter never submits from the product search or a quantity (a destructive full replace); only the name field submits. */
  const blockEnterSubmit = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLInputElement && event.target !== nameInput.current) event.preventDefault();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (valid && !save.isPending) save.mutate();
  };

  const updateLine = (key: string, patch: Partial<FormLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // Registered before paint so the dialog's footer bar never flashes empty, and kept in sync with save.isPending.
  useLayoutEffect(() => {
    onFooterChange(
      <>
        <DialogClose asChild>
          <Button variant="secondary">Cancelar</Button>
        </DialogClose>
        <Button type="submit" form={FORM_ID} variant="primary" loading={save.isPending}>
          Salvar modelo
        </Button>
      </>,
    );
    return () => onFooterChange(null);
  }, [onFooterChange, save.isPending]);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- catches Enter bubbling from descendant inputs (product search, quantity), not a click/keyboard interaction on the form itself */}
      <form
        id={FORM_ID}
        onSubmit={submit}
        onKeyDown={blockEnterSubmit}
        noValidate
        aria-label="Editar modelo"
        className="flex flex-col gap-3"
      >
        {failure && !nameTaken ? (
          <Alert
            tone="danger"
            title={failure.title}
            action={
              failure.reason === "version_conflict" ? (
                <Button size="sm" loading={reloading} onClick={onReload}>
                  Recarregar
                </Button>
              ) : undefined
            }
          >
            {failure.description}
            {failure.correlationId ? (
              <span className="mt-1 block text-xs">
                Código de correlação: <span className="font-mono">{failure.correlationId}</span>
              </span>
            ) : null}
          </Alert>
        ) : null}

        <FormField
          label="Nome do modelo"
          required
          error={nameTaken ? "Já existe um modelo com este nome para este cliente." : showProblems ? (nameProblem ?? undefined) : undefined}
        >
          <Input
            size="md"
            ref={nameInput}
            value={name}
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (nameTaken) save.reset();
            }}
          />
        </FormField>

        <FormField
          id={PRODUCT_SEARCH_ID}
          label="Adicionar produto"
          hint={lines.length >= MAX_TEMPLATE_ITEMS ? `Limite de ${MAX_TEMPLATE_ITEMS} produtos por modelo.` : undefined}
        >
          {(controlProps) => (
            <ProductPicker
              {...controlProps}
              customerCode={customerCode}
              disabled={lines.length >= MAX_TEMPLATE_ITEMS}
              onSelect={(product) => {
                if (lines.some((line) => line.productCode === product.code)) {
                  toast({ title: "Produto já está no modelo", description: product.description, tone: "warning" });
                  return;
                }
                setLines((current) => [
                  ...current,
                  { key: nextKey(), productCode: product.code, description: product.description, quantityText: "1" },
                ]);
              }}
            />
          )}
        </FormField>

        {lines.length === 0 ? (
          <div>
            <p className="m-0 text-xs text-fg-muted">Nenhum produto no modelo. Busque um produto acima.</p>
            {showProblems && itemsProblem ? <FieldError>{itemsProblem}</FieldError> : null}
          </div>
        ) : (
          <Table label="Itens do modelo" maxHeightClassName="max-h-[40vh]">
            <TableCaption>Itens do modelo</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead numeric>#</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Quantidade</TableHead>
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const parse = parsed[index];
                const problem = showProblems && parse && !parse.ok ? quantityProblemMessages[parse.problem] : null;
                const description = line.description ?? descriptions?.get(line.productCode) ?? null;
                const label = description ?? `produto ${line.productCode}`;
                const errorId = `template-qty-error-${line.key}`;
                return (
                  <TableRow key={line.key}>
                    <TableCell numeric>{index + 1}</TableCell>
                    <TableCell wrap>
                      <span className="font-medium">{description ?? `Produto ${line.productCode}`}</span>
                      <span className="block text-fg-muted">Código {line.productCode}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        size="sm"
                        inputMode="decimal"
                        autoComplete="off"
                        wrapperClassName="w-[110px]"
                        value={line.quantityText}
                        aria-label={`Quantidade de ${label}`}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? errorId : undefined}
                        onChange={(event) => updateLine(line.key, { quantityText: event.target.value })}
                      />
                      {problem ? <FieldError id={errorId}>{problem}</FieldError> : null}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${label}`}
                        onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <FieldHint>Produtos indisponíveis hoje continuam no modelo e são deixados de fora, com aviso, ao criar o pedido.</FieldHint>
      </form>
    </>
  );
}
