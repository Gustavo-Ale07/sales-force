import type { ProductGroupsFetch } from "@salesforce/mobile-db";

/**
 * Grupo > Subgrupo > Linha cascade of the catalog, mirror of the site's `group-cascade-filter` (same levels, same names, same
 * rules). Pure: the hierarchy comes resolved from the server (by parent code, never by code prefix) and filtering uses the
 * server's own `subtreeCodes`, so the offline result is the one `GET /products?group=` returns.
 */
export type ProductGroupTree = ProductGroupsFetch;
export type ProductGroupNode = ProductGroupsFetch["items"][number];

/** The "Sem grupo" option (products without a group: null or 0). Only at the first level. */
export const NO_GROUP_CODE = 0;

/** One code per level (Grupo, Subgrupo, Linha); an absent level is "Todos". */
export type GroupPath = readonly number[];

export interface CascadeOption {
  readonly value: number;
  readonly label: string;
}

export interface CascadeLevel {
  readonly label: "Grupo" | "Subgrupo" | "Linha";
  readonly options: readonly CascadeOption[];
  /** `null` = Todos. */
  readonly value: number | null;
  readonly disabled: boolean;
}

const LEVEL_LABELS = ["Grupo", "Subgrupo", "Linha"] as const;

/**
 * Levels to render. Grupo and Subgrupo are always shown (Subgrupo is off until a group with children is chosen); Linha appears
 * only when the chosen subgrupo has children. A flat answer (`hierarchical: false`) is Grupo alone. Anything in `path` that is
 * not an option of its level cuts the path there (the data changed under the selection).
 */
export function cascadeLevels(tree: ProductGroupTree, path: GroupPath): { levels: CascadeLevel[]; path: number[] } {
  const childrenOf = (parent: number | null) => tree.items.filter((item) => item.parentCode === parent);
  const toOptions = (nodes: readonly ProductGroupNode[]): CascadeOption[] => nodes.map((node) => ({ value: node.code, label: node.name }));
  const top = toOptions(childrenOf(null));
  if (tree.hasUngrouped) top.push({ value: NO_GROUP_CODE, label: "Sem grupo" });

  const levels: CascadeLevel[] = [];
  const valid: number[] = [];
  let options: readonly CascadeOption[] = top;
  for (let depth = 0; depth < LEVEL_LABELS.length; depth += 1) {
    const chosen = path[depth];
    const value = chosen !== undefined && options.some((option) => option.value === chosen) ? chosen : null;
    levels.push({ label: LEVEL_LABELS[depth] as CascadeLevel["label"], options, value, disabled: depth > 0 && options.length === 0 });
    if (value === null) break;
    valid.push(value);
    const parent = tree.items.find((item) => item.code === value);
    if (!tree.hierarchical || parent === undefined || !parent.hasChildren) {
      // Final group (or "Sem grupo"): the next level stays off; Subgrupo is shown disabled, Linha is not shown.
      if (depth === 0 && tree.hierarchical) levels.push({ label: "Subgrupo", options: [], value: null, disabled: true });
      break;
    }
    options = toOptions(childrenOf(parent.code));
  }
  if (levels.length === 1 && tree.hierarchical) levels.push({ label: "Subgrupo", options: [], value: null, disabled: true });
  return { levels, path: valid };
}

/** Codes the local filter matches: the subtree of the deepest level chosen (`[0]` = Sem grupo; empty = Todos). */
export function groupCodesOf(tree: ProductGroupTree, path: GroupPath): number[] {
  const deepest = path.at(-1);
  if (deepest === undefined) return [];
  if (deepest === NO_GROUP_CODE) return [NO_GROUP_CODE];
  const node = tree.items.find((item) => item.code === deepest);
  return node === undefined ? [deepest] : [...node.subtreeCodes];
}

/** Chip text of the applied filter: the deepest level and its name. */
export function groupPathLabel(tree: ProductGroupTree, path: GroupPath): string {
  const depth = path.length - 1;
  const code = path[depth];
  const level = LEVEL_LABELS[depth] ?? "Grupo";
  if (code === undefined) return "";
  if (code === NO_GROUP_CODE) return `${level}: Sem grupo`;
  return `${level}: ${tree.items.find((item) => item.code === code)?.name ?? `Grupo ${code}`}`;
}
