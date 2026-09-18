import { X } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "../lib/cn";
import type { AlertTone } from "./alert";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: AlertTone;
  /** ms before auto-dismiss (default 5000; errors 8000). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  open: boolean;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Imperative API: `toast({ title: "Rascunho salvo", tone: "success" })`. Mount <Toaster /> once. */
export function toast(options: ToastOptions): number {
  const id = nextId++;
  items = [...items, { ...options, id, open: true }];
  emit();
  return id;
}

export function dismissToast(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, open: false } : item));
  emit();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 300);
}

const toneBar: Record<AlertTone, string> = {
  info: "border-l-info",
  success: "border-l-ok",
  warning: "border-l-warn",
  danger: "border-l-danger",
  neutral: "border-l-line-strong",
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => items;

export function Toaster({ label = "Notificações" }: { label?: string }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <RadixToast.Provider swipeDirection="right" label={label}>
      {current.map((item) => (
        <RadixToast.Root
          key={item.id}
          open={item.open}
          duration={item.duration ?? (item.tone === "danger" ? 8000 : 5000)}
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id);
          }}
          className={cn(
            "flex animate-sf-toast-in items-start gap-3 rounded-md border border-l-[3px] border-line-strong bg-surface px-3 py-2.5 shadow-pop",
            toneBar[item.tone ?? "neutral"],
          )}
        >
          <div className="min-w-0 flex-1">
            <RadixToast.Title className="text-sm font-semibold text-fg">{item.title}</RadixToast.Title>
            {item.description ? (
              <RadixToast.Description className="mt-0.5 text-xs text-fg-muted">{item.description}</RadixToast.Description>
            ) : null}
          </div>
          <RadixToast.Close
            aria-label="Fechar notificação"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3"
          >
            <X size={13} aria-hidden="true" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-[60] m-0 flex w-[360px] max-w-[calc(100vw-2rem)] list-none flex-col gap-2 p-0 outline-none" />
    </RadixToast.Provider>
  );
}
