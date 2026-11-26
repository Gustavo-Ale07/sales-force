import { Input, type InputProps } from "@salesforce/ui";
import { useId, useMemo } from "react";
import { normalizeName } from "../lib/customer-form";

export interface SuggestOption {
  code: number;
  name: string;
}

export interface SuggestInputProps extends Omit<InputProps, "value" | "onChange" | "list"> {
  value: string;
  /** Free text typed or a suggestion picked: the caller matches the text against the registry to find the code. */
  onValueChange: (text: string) => void;
  options: readonly SuggestOption[];
}

const MAX_SUGGESTIONS = 30;

/** Text field with suggestions from a registry: any text is accepted, picking a suggestion just fills its exact name. */
export function SuggestInput({ value, onValueChange, options, ...props }: SuggestInputProps) {
  const listId = useId();
  const suggestions = useMemo(() => {
    const needle = normalizeName(value);
    if (needle.length < 2) return [];
    const seen = new Set<string>();
    const out: SuggestOption[] = [];
    for (const option of options) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (seen.has(option.name) || !normalizeName(option.name).includes(needle)) continue;
      seen.add(option.name);
      out.push(option);
    }
    return out;
  }, [options, value]);
  return (
    <>
      <Input {...props} value={value} list={listId} autoComplete="off" onChange={(event) => onValueChange(event.target.value)} />
      <datalist id={listId}>
        {suggestions.map((option) => (
          <option key={option.code} value={option.name} />
        ))}
      </datalist>
    </>
  );
}
