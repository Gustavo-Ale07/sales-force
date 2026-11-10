import { Select } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import type { ApiSchema } from "@salesforce/contracts/client";
import { productGroupsQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";

type GroupNode = ApiSchema<"ProductGroup">;

/**
 * Selected codes of the cascade, one per level (Grupo, Subgrupo, Linha); an absent level is "Todos". `"0"` is the special
 * "Sem grupo" option (only at the first level). Kept by the host, like the rest of its filters.
 */
export type GroupPath = readonly string[];

export const EMPTY_GROUP_PATH: GroupPath = [];

/** Code the server filters by: the deepest level chosen (the server expands it to every descendant). `undefined` = Todos. */
export function groupFilterValue(path: GroupPath): number | undefined {
  const last = path.at(-1);
  return last === undefined || last === "" ? undefined : Number(last);
}

export interface CascadeLevel {
  readonly label: string;
  readonly options: readonly { value: string; label: string }[];
  readonly value: string;
  readonly disabled: boolean;
}

export const NO_GROUP_VALUE = "0";
const LEVEL_LABELS = ["Grupo", "Subgrupo", "Linha"] as const;

/**
 * Levels to render. Grupo and Subgrupo are always shown (Subgrupo is off until a group with children is chosen); Linha appears
 * only when the chosen subgrupo has children. A flat answer (`hierarchical: false`, hierarchy not mirrored yet) is Grupo alone.
 * Anything in `path` that is not an option of its level cuts the path there (the data changed under the selection).
 */
export function cascadeLevels(
  items: readonly GroupNode[],
  hierarchical: boolean,
  hasUngrouped: boolean,
  path: GroupPath,
): { levels: CascadeLevel[]; path: string[] } {
  const childrenOf = (parent: number | null) => items.filter((item) => item.parentCode === parent);
  const toOptions = (nodes: readonly GroupNode[]) => nodes.map((node) => ({ value: String(node.code), label: node.name }));
  const top = toOptions(childrenOf(null));
  if (hasUngrouped) top.push({ value: NO_GROUP_VALUE, label: "Sem grupo" });

  const levels: CascadeLevel[] = [];
  const valid: string[] = [];
  let options = top;
  let parent: GroupNode | undefined;
  for (let depth = 0; depth < LEVEL_LABELS.length; depth += 1) {
    const chosen = path[depth] ?? "";
    const known = options.some((option) => option.value === chosen);
    const value = known ? chosen : "";
    levels.push({ label: LEVEL_LABELS[depth] as string, options, value, disabled: depth > 0 && options.length === 0 });
    if (value === "") break;
    valid.push(value);
    parent = items.find((item) => String(item.code) === value);
    if (!hierarchical || parent === undefined || !parent.hasChildren) {
      // Final group (or "Sem grupo"): the next level stays off — Subgrupo is shown disabled, Linha is not shown.
      if (depth === 0 && hierarchical) levels.push({ label: LEVEL_LABELS[1], options: [], value: "", disabled: true });
      break;
    }
    options = toOptions(childrenOf(parent.code));
  }
  if (levels.length === 1 && hierarchical) levels.push({ label: LEVEL_LABELS[1], options: [], value: "", disabled: true });
  return { levels, path: valid };
}

export interface GroupCascadeFilterProps {
  path: GroupPath;
  onChange: (path: GroupPath) => void;
  /** Appended to each accessible name (the same control lives in more than one screen). */
  ariaSuffix?: string;
}

/**
 * Grupo > Subgrupo > Linha filter shared by the product browser, the multi-select and the order product filter. The hierarchy
 * comes resolved from the server (by parent code, never by code prefix); choosing a group that is not final filters by all of its
 * descendants, also resolved on the server. Changing a level clears the ones below it.
 */
export function GroupCascadeFilter({ path, onChange, ariaSuffix = "" }: GroupCascadeFilterProps) {
  const api = useApi();
  const groups = useQuery(productGroupsQueryOptions(api));
  const { levels } = cascadeLevels(groups.data?.items ?? [], groups.data?.hierarchical ?? false, groups.data?.hasUngrouped ?? false, path);
  return (
    <>
      {levels.map((level, depth) => (
        <Select
          key={level.label}
          size="md"
          aria-label={`${level.label}${ariaSuffix}`}
          value={level.value}
          disabled={level.disabled}
          onChange={(event) => onChange(event.target.value === "" ? path.slice(0, depth) : [...path.slice(0, depth), event.target.value])}
          wrapperClassName="w-full sm:w-[200px]"
        >
          <option value="">{depth === 0 ? "Todos os grupos" : level.label === "Subgrupo" ? "Todos os subgrupos" : "Todas as linhas"}</option>
          {level.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ))}
    </>
  );
}
