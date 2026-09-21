import { useEffect, useRef, useState } from "react";
import { useDebounced } from "./use-debounced";

/**
 * Search text box whose value is committed (to the URL) after a pause. Local text keeps typing responsive; an
 * external change of the committed value (e.g. removing a filter chip) resets the box.
 */
export function useSearchBox(committed: string | undefined, commit: (value: string | undefined) => void, delayMs = 350) {
  const [text, setText] = useState(committed ?? "");
  const lastCommitted = useRef(committed);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  const debounced = useDebounced(text.trim(), delayMs);

  useEffect(() => {
    const next = debounced === "" ? undefined : debounced;
    if (next !== lastCommitted.current) {
      lastCommitted.current = next;
      commitRef.current(next);
    }
  }, [debounced]);

  useEffect(() => {
    if (committed !== lastCommitted.current) {
      lastCommitted.current = committed;
      setText(committed ?? "");
    }
  }, [committed]);

  return [text, setText] as const;
}
