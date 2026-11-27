import {
  Alert,
  Button,
  Card,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
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
import { Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { QueryError } from "../components/query-error";
import { createSellerDiscountRule, deleteSellerDiscountRule, updateSellerDiscountRule } from "../lib/api-mutations";
import { productGroupsQueryOptions, productsQueryOptions, queryKeys, sellerDiscountRulesQueryOptions, sellersQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import {
  emptyRuleForm,
  formatPercent,
  groupsOfKind,
  normalizePercent,
  percentProblem,
  ruleProblems,
  ruleTargetLabel,
  TARGET_KINDS,
  TARGET_KIND_LABELS,
  toCreateBody,
  type DiscountRule,
  type RuleForm,
  type RuleTargetKind,
} from "../lib/discount-rules";
import { describeApiError } from "../lib/error-message";
import { errorStatus } from "../lib/http-error";
import { useDebounced } from "../lib/use-debounced";

type Dialogue = { kind: "create" } | { kind: "edit"; rule: DiscountRule } | { kind: "delete"; rule: DiscountRule } | null;

function failureOf(error: unknown, fallback: string) {
  if (errorStatus(error) === 409) return { title: "Já existe uma regra para este representante e alvo", description: undefined };
  return describeApiError(error, fallback);
}

export function SellerDiscountRulesPage() {
  const api = useApi();
  const sellers = useQuery(sellersQueryOptions(api));
  const [sellerFilter, setSellerFilter] = useState("");
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const query = useQuery(sellerDiscountRulesQueryOptions(api, sellerFilter === "" ? undefined : Number(sellerFilter)));
  const sellerList = sellers.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Descontos por representante"
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setDialogue({ kind: "create" })}>
            Nova regra
          </Button>
        }
      />
      <div className="mb-3 max-w-sm">
        <FormField label="Representante">
          <Select size="md" value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}>
            <option value="">Todos</option>
            {sellerList.map((seller) => (
              <option key={seller.code} value={seller.code}>
                {seller.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <Card>
        {query.isPending ? (
          <div aria-busy="true" className="p-3">
            <SkeletonLines lines={5} label="Carregando regras…" />
          </div>
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar as regras" />
        ) : query.data.items.length === 0 ? (
          <EmptyState title="Nenhuma regra" />
        ) : (
          <Table label="Regras de desconto">
            <TableCaption>Regras de desconto por representante</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Representante</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Alvo</TableHead>
                <TableHead>Máximo (%)</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.sellerName ?? `Representante ${rule.sellerCode}`}</TableCell>
                  <TableCell>{TARGET_KIND_LABELS[rule.targetKind]}</TableCell>
                  <TableCell wrap>{ruleTargetLabel(rule)}</TableCell>
                  <TableCell>{formatPercent(rule.maxPercent)}</TableCell>
                  <TableCell>
                    <span className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setDialogue({ kind: "edit", rule })}>
                        Editar
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setDialogue({ kind: "delete", rule })}>
                        Excluir
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={dialogue !== null} onOpenChange={(open) => (open ? undefined : setDialogue(null))}>
        {dialogue?.kind === "create" ? <CreateBody initialSeller={sellerFilter === "" ? null : sellerFilter} onClose={() => setDialogue(null)} /> : null}
        {dialogue?.kind === "edit" ? <EditBody rule={dialogue.rule} onClose={() => setDialogue(null)} /> : null}
        {dialogue?.kind === "delete" ? <DeleteBody rule={dialogue.rule} onClose={() => setDialogue(null)} /> : null}
      </Dialog>
    </>
  );
}

function useRulesInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.sellerDiscountRules });
}

function CreateBody({ initialSeller, onClose }: { initialSeller: string | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useRulesInvalidation();
  const sellers = useQuery(sellersQueryOptions(api));
  const groups = useQuery(productGroupsQueryOptions(api));
  const [form, setForm] = useState<RuleForm>(() => emptyRuleForm(initialSeller));
  const [showProblems, setShowProblems] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [pickedProduct, setPickedProduct] = useState<{ value: string; label: string } | null>(null);
  const debounced = useDebounced(productSearch.trim(), 300);
  const productsEnabled = form.targetKind === "product" && debounced.length >= 2;
  const products = useQuery({ ...productsQueryOptions(api, { search: debounced, pageSize: 20 }), enabled: productsEnabled });
  const problems = ruleProblems(form);
  const hasProblems = Object.keys(problems).length > 0;

  const save = useMutation({
    mutationFn: () => createSellerDiscountRule(api, toCreateBody(form)),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Regra salva", tone: "success" });
      onClose();
    },
  });
  const failure = save.isError ? failureOf(save.error, "Não foi possível salvar a regra") : null;

  const sellerOptions = (sellers.data?.items ?? []).map((seller) => ({ value: String(seller.code), label: seller.name, description: String(seller.code) }));
  const targetOptions = useMemo(() => {
    if (form.targetKind === "group" || form.targetKind === "subgroup") {
      return groupsOfKind(groups.data?.items ?? [], form.targetKind).map((group) => ({ value: String(group.code), label: group.name, description: String(group.code) }));
    }
    if (form.targetKind === "product") {
      const found = (products.data?.items ?? []).map((product) => ({ value: String(product.code), label: product.description, description: String(product.code) }));
      return pickedProduct && !found.some((option) => option.value === pickedProduct.value) ? [pickedProduct, ...found] : found;
    }
    return [];
  }, [form.targetKind, groups.data, products.data, pickedProduct]);

  const setKind = (targetKind: RuleTargetKind) => {
    setForm((current) => ({ ...current, targetKind, targetCode: null }));
    setPickedProduct(null);
    setProductSearch("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (!hasProblems && !save.isPending) save.mutate();
  };

  return (
    <DialogContent
      title="Nova regra"
      className="max-w-lg"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form="seller-rule-form" variant="primary" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="seller-rule-form" onSubmit={submit} noValidate aria-label="Nova regra" className="flex flex-col gap-3">
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
          </Alert>
        ) : null}
        <FormField label="Representante" required error={showProblems ? problems.seller : undefined}>
          {(controlProps) => (
            <Combobox {...controlProps} options={sellerOptions} value={form.sellerCode} loading={sellers.isPending} onValueChange={(value) => setForm((current) => ({ ...current, sellerCode: value }))} />
          )}
        </FormField>
        <FormField label="Aplicar a">
          <Select size="md" value={form.targetKind} onChange={(event) => setKind(event.target.value as RuleTargetKind)}>
            {TARGET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {TARGET_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </FormField>
        {form.targetKind !== "none" ? (
          <FormField label={TARGET_KIND_LABELS[form.targetKind]} required error={showProblems ? problems.target : undefined}>
            {(controlProps) => (
              <Combobox
                {...controlProps}
                options={targetOptions}
                value={form.targetCode}
                loading={form.targetKind === "product" ? products.isFetching : groups.isPending}
                onSearchChange={form.targetKind === "product" ? setProductSearch : undefined}
                onValueChange={(value) => {
                  setForm((current) => ({ ...current, targetCode: value }));
                  setPickedProduct(value === null ? null : (targetOptions.find((option) => option.value === value) ?? null));
                }}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="Máximo (%)" required error={showProblems ? problems.percent : undefined}>
          <Input size="md" inputMode="decimal" autoComplete="off" value={form.percent} onChange={(event) => setForm((current) => ({ ...current, percent: event.target.value }))} />
        </FormField>
      </form>
    </DialogContent>
  );
}

function EditBody({ rule, onClose }: { rule: DiscountRule; onClose: () => void }) {
  const api = useApi();
  const invalidate = useRulesInvalidation();
  const [percent, setPercent] = useState(formatPercent(rule.maxPercent));
  const [showProblems, setShowProblems] = useState(false);
  const problem = percentProblem(percent);
  const save = useMutation({
    mutationFn: () => updateSellerDiscountRule(api, rule.id, normalizePercent(percent)),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Regra salva", tone: "success" });
      onClose();
    },
  });
  const failure = save.isError ? failureOf(save.error, "Não foi possível salvar a regra") : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (problem === null && !save.isPending) save.mutate();
  };
  return (
    <DialogContent
      title="Editar regra"
      description={`${rule.sellerName ?? `Representante ${rule.sellerCode}`} - ${ruleTargetLabel(rule)}`}
      className="max-w-lg"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form="seller-rule-edit-form" variant="primary" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="seller-rule-edit-form" onSubmit={submit} noValidate aria-label="Editar regra" className="flex flex-col gap-3">
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.description}
          </Alert>
        ) : null}
        <FormField label="Máximo (%)" required error={showProblems && problem ? problem : undefined}>
          <Input size="md" inputMode="decimal" autoComplete="off" value={percent} onChange={(event) => setPercent(event.target.value)} />
        </FormField>
      </form>
    </DialogContent>
  );
}

function DeleteBody({ rule, onClose }: { rule: DiscountRule; onClose: () => void }) {
  const api = useApi();
  const invalidate = useRulesInvalidation();
  const remove = useMutation({
    mutationFn: () => deleteSellerDiscountRule(api, rule.id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Regra excluída", tone: "success" });
      onClose();
    },
  });
  const failure = remove.isError ? describeApiError(remove.error, "Não foi possível excluir a regra") : null;
  return (
    <DialogContent
      title="Excluir regra"
      description={`${rule.sellerName ?? `Representante ${rule.sellerCode}`} - ${ruleTargetLabel(rule)}`}
      className="max-w-lg"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Excluir
          </Button>
        </>
      }
    >
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.description}
        </Alert>
      ) : null}
    </DialogContent>
  );
}
