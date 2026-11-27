import type { ApiSchema } from "@salesforce/contracts/client";

export type DiscountRule = ApiSchema<"SellerDiscountRuleRecord">;
export type RuleTargetKind = ApiSchema<"DiscountRuleTargetKind">;
type ProductGroup = ApiSchema<"ProductGroup">;

export const TARGET_KIND_LABELS: Record<RuleTargetKind, string> = {
  none: "Geral",
  group: "Grupo",
  subgroup: "Subgrupo",
  product: "Produto",
};

export const TARGET_KINDS: readonly RuleTargetKind[] = ["none", "group", "subgroup", "product"];

// Same shape the server accepts: 0 to 100, up to four decimals. Text, never `number`.
const PERCENT = /^(100(\.0+)?|\d{1,2}(\.\d{1,4})?)$/;

/** Accepts the pt-BR comma while typing; the API always receives a dot. */
export function normalizePercent(raw: string): string {
  return raw.trim().replace(",", ".");
}

export function percentProblem(raw: string): string | null {
  const value = normalizePercent(raw);
  if (value === "") return "Informe o percentual.";
  return PERCENT.test(value) ? null : "Use de 0 a 100, com até quatro casas decimais.";
}

/** "12.5000" -> "12,5"; "10" -> "10". */
export function formatPercent(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? integer : `${integer},${trimmed}`;
}

/** Group codes of a level: `group` = top of the cascade, `subgroup` = any deeper level. */
export function groupsOfKind(groups: readonly ProductGroup[], kind: "group" | "subgroup"): ProductGroup[] {
  return groups.filter((group) => (kind === "group" ? group.parentCode === null : group.parentCode !== null));
}

export function ruleTargetLabel(rule: Pick<DiscountRule, "targetKind" | "targetCode" | "targetName">): string {
  if (rule.targetKind === "none") return "Geral";
  const name = rule.targetName ?? "Sem nome";
  return `${name} (${rule.targetCode})`;
}

export interface RuleForm {
  sellerCode: string | null;
  targetKind: RuleTargetKind;
  targetCode: string | null;
  percent: string;
}

export const emptyRuleForm = (sellerCode: string | null = null): RuleForm => ({ sellerCode, targetKind: "none", targetCode: null, percent: "" });

export interface RuleProblems {
  seller?: string;
  target?: string;
  percent?: string;
}

export function ruleProblems(form: RuleForm): RuleProblems {
  const problems: RuleProblems = {};
  if (form.sellerCode === null) problems.seller = "Selecione o representante.";
  if (form.targetKind !== "none" && form.targetCode === null) problems.target = "Selecione o alvo.";
  const percent = percentProblem(form.percent);
  if (percent) problems.percent = percent;
  return problems;
}

/** Body of POST /seller-discount-rules; call only when `ruleProblems` is empty. */
export function toCreateBody(form: RuleForm): ApiSchema<"CreateSellerDiscountRuleRequest"> {
  return {
    sellerCode: Number(form.sellerCode),
    targetKind: form.targetKind,
    targetCode: form.targetKind === "none" ? null : Number(form.targetCode),
    maxPercent: normalizePercent(form.percent),
  };
}
