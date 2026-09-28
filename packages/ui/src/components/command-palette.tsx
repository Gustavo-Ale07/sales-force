import { CornerDownLeft, Search } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "../lib/cn";

export interface CommandItem {
  id: string;
  label: string;
  /** Group heading ("Páginas", "Ações"); items of the same group are listed together, in the order given. */
  group: string;
  icon?: ReactNode;
  /** Extra words that also match (synonyms), never shown. */
  keywords?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  /** Accessible name of the dialog. */
  title?: string;
  placeholder?: string;
  /** Shown when nothing matches; receives the current query. */
  renderEmpty?: (query: string) => ReactNode;
  /**
   * The element that opened the palette. `open`/`onOpenChange` are caller-controlled (no `Dialog.Trigger`
   * is rendered), so Radix has no trigger to restore focus to on close and falls back to the document body.
   */
  triggerRef?: RefObject<HTMLElement | null>;
}

/** Lower-case without accents so "catalogo" finds "Catálogo". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function filterItems(items: CommandItem[], query: string): CommandItem[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const haystack = normalize(`${item.label} ${item.keywords ?? ""}`);
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Command palette (reference `.pl-cmd`): a modal search over a caller-supplied list of destinations and actions.
 * It has no data source of its own. Combobox pattern: focus stays in the input, ArrowUp/ArrowDown move the
 * highlighted option (`aria-activedescendant`), Enter runs it, Escape closes (Radix), first result preselected.
 */
export function CommandPalette({ open, onOpenChange, ...rest }: CommandPaletteProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so the query and highlight start fresh every time (no reset effect). */}
      {open ? <PaletteBody onOpenChange={onOpenChange} {...rest} /> : null}
    </RadixDialog.Root>
  );
}

function PaletteBody({
  onOpenChange,
  items,
  title = "Busca rápida",
  placeholder = "Ir para…",
  renderEmpty,
  triggerRef,
}: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterItems(items, query), [items, query]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, CommandItem[]>();
    for (const item of results) {
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        order.push(item.group);
      }
      byGroup.get(item.group)?.push(item);
    }
    return order.map((name) => ({ name, items: byGroup.get(name) ?? [] }));
  }, [results]);
  // Options are indexed in display order (grouped), which can differ from the flat filter order.
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const activeItem = flat[activeIndex];
  const optionId = (id: string) => `${listId}-${id}`;

  useEffect(() => {
    if (!activeItem) return;
    listRef.current?.querySelector(`[id="${optionId(activeItem.id)}"]`)?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from listId, which is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem]);

  const run = (item: CommandItem) => {
    onOpenChange(false);
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + flat.length) % flat.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : Math.max(0, flat.length - 1));
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      run(activeItem);
    }
  };

  return (
    <>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-sf-fade-in bg-scrim data-[state=closed]:animate-sf-fade-out" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!triggerRef?.current) return;
            event.preventDefault();
            triggerRef.current.focus();
          }}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100vw-2rem)] max-w-[620px] -translate-x-1/2 animate-sf-pop-in flex-col overflow-hidden rounded-[20px] data-[state=closed]:animate-sf-pop-out bg-surface shadow-overlay"
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-fg-muted" />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette exists to be typed into; Radix also restores focus on close
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeItem ? optionId(activeItem.id) : undefined}
              aria-autocomplete="list"
              aria-label={placeholder.replace(/…$/, "")}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={placeholder}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-fg outline-none placeholder:text-fg-faint"
            />
            <kbd className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-2xs font-semibold text-fg-muted">Esc</kbd>
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto p-2">
            {flat.length === 0 ? (
              <div role="status" className="px-3 py-8 text-center text-sm text-fg-muted">
                {renderEmpty ? renderEmpty(query) : "Nenhum resultado."}
              </div>
            ) : (
              groups.map((group, groupIndex) => {
                const headingId = `${listId}-g-${groupIndex}`;
                return (
                  <div key={group.name} role="group" aria-labelledby={headingId} className="pb-1">
                    <div id={headingId} className="px-3 pb-1 pt-3 text-xs font-medium text-fg-muted">
                      {group.name}
                    </div>
                    {group.items.map((item) => {
                      const selected = item.id === activeItem?.id;
                      return (
                        // Keyboard access is the input's (combobox); the option itself only needs pointer handlers.
                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                        <div
                          key={item.id}
                          id={optionId(item.id)}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(flat.indexOf(item))}
                          onClick={() => run(item)}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-fg transition-colors duration-[var(--sf-dur-fast)]",
                            selected && "bg-surface-3",
                          )}
                        >
                          {item.icon ? (
                            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-fg-muted">
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {selected ? <CornerDownLeft size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-fg-faint" /> : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </>
  );
}
