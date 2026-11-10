/**
 * Product group hierarchy (TGFGRU mirror) — pure rules, no database. The hierarchy is read by `parentCode`, never by code
 * prefix. Cycles and absurd depth are anomalies: the walk always ends (depth limit + visited set) and never hangs a request.
 */

export interface GroupRow {
  readonly code: number;
  readonly name: string;
  readonly parentCode: number | null;
  readonly degree: number;
  readonly active: boolean;
}

export interface GroupNode {
  readonly code: number;
  readonly name: string;
  /** `null` = top level (also an orphan whose parent is hidden/absent, or a group inside a cycle). */
  readonly parentCode: number | null;
  readonly degree: number;
  /** At least one visible group has this one as its parent: the next level of the cascade opens. */
  readonly hasChildren: boolean;
}

/** The deepest hierarchy walked (the real one has 3 levels); beyond it the chain is an anomaly. */
export const MAX_GROUP_DEPTH = 10;

/** Ancestors of `code` (nearest first). `cyclic` = the chain loops or exceeds the depth limit. */
function ancestorsOf(byCode: ReadonlyMap<number, GroupRow>, code: number): { ancestors: number[]; cyclic: boolean } {
  const seen = new Set<number>([code]);
  const ancestors: number[] = [];
  let parent = byCode.get(code)?.parentCode ?? null;
  while (parent !== null && byCode.has(parent)) {
    if (seen.has(parent) || ancestors.length >= MAX_GROUP_DEPTH) return { ancestors, cyclic: true };
    seen.add(parent);
    ancestors.push(parent);
    parent = byCode.get(parent)?.parentCode ?? null;
  }
  return { ancestors, cyclic: false };
}

/**
 * Groups the filter offers: active groups holding an active-visible product directly or through any descendant. `productGroupCodes`
 * are the group codes of the products that count (already narrowed by `showInactive`).
 */
export function visibleGroups(groups: readonly GroupRow[], productGroupCodes: ReadonlySet<number>): GroupNode[] {
  const byCode = new Map(groups.map((group) => [group.code, group] as const));
  const withProducts = new Set<number>();
  for (const code of productGroupCodes) {
    if (!byCode.has(code)) continue;
    withProducts.add(code);
    for (const ancestor of ancestorsOf(byCode, code).ancestors) withProducts.add(ancestor);
  }
  const visible = groups.filter((group) => group.active && withProducts.has(group.code));
  const visibleCodes = new Set(visible.map((group) => group.code));
  const parentOf = (group: GroupRow): number | null => {
    if (group.parentCode === null || !visibleCodes.has(group.parentCode)) return null;
    return ancestorsOf(byCode, group.code).cyclic ? null : group.parentCode;
  };
  const parents = new Map(visible.map((group) => [group.code, parentOf(group)] as const));
  const withChildren = new Set([...parents.values()].filter((parent): parent is number => parent !== null));
  return visible
    .map((group) => ({
      code: group.code,
      name: group.name,
      parentCode: parents.get(group.code) ?? null,
      degree: group.degree,
      hasChildren: withChildren.has(group.code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.code - b.code);
}

/** `code` plus every descendant of any depth (by `parentCode`), cycle-safe. An unknown code yields just itself. */
export function subtreeOf(groups: readonly GroupRow[], code: number): number[] {
  const children = new Map<number, number[]>();
  for (const group of groups) {
    if (group.parentCode === null) continue;
    children.set(group.parentCode, [...(children.get(group.parentCode) ?? []), group.code]);
  }
  const seen = new Set<number>([code]);
  let frontier = [code];
  for (let depth = 0; depth < MAX_GROUP_DEPTH && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const parent of frontier) {
      for (const child of children.get(parent) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return [...seen];
}
